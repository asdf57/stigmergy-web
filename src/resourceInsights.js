import { humanize, referenceKinds } from './resourceCatalog.js'

const statusReferenceKinds = {
  pipelineRef: 'Pipeline', secretRef: 'Secret', bootISORef: 'ISO',
  installedKeyPairRef: 'SSHKeyPair', activeRunRef: 'ProvisioningRun',
  lastRunRef: 'ProvisioningRun', lastSuccessfulRunRef: 'ProvisioningRun',
  backingStoreRef: 'Router', destinationRef: 'GitRepository',
}

/** Extract named relationships, never arbitrary Secret data or execution inputs. */
export function resourceReferences(item) {
  const references = []
  const excluded = new Set(['data', 'inputs', 'values', 'definition', 'script', 'publishedInputContent'])
  function walk(value, path = '') {
    if (!value || typeof value !== 'object') return
    for (const [field, child] of Object.entries(value)) {
      if (excluded.has(field)) continue
      const kind = referenceKinds[field] || statusReferenceKinds[field]
      const location = path ? `${path}.${field}` : field
      if (kind) {
        for (const reference of Array.isArray(child) ? child : [child]) {
          const name = typeof reference === 'string' ? reference : reference?.name
          if (name) references.push({ kind, name, uid: reference?.uid, field: location })
        }
      } else if (field === 'resolvedReferences' && Array.isArray(child)) {
        for (const reference of child) {
          if (reference?.kind && reference?.name && reference?.uid) references.push({ ...reference, field: location })
        }
      } else if (field.endsWith('Ref') && child?.kind && child?.name) {
        references.push({ ...child, field: location })
      } else walk(child, location)
    }
  }
  walk({ spec: item.spec, status: item.status })
  return references
}

export function serverNames(item) {
  return [...new Set([
    ...(item.kind === 'Server' ? [item.metadata.name] : []),
    ...resourceReferences(item).filter(reference => reference.kind === 'Server').map(reference => reference.name),
  ])]
}

/** All filters are client-side; no unsupported API selectors or writes. */
export function filterResources(items, filters, phaseOf) {
  const query = (filters.query || '').toLowerCase()
  const labelQuery = (filters.label || '').trim().toLowerCase()
  return items.filter(item => {
    const labels = Object.entries(item.metadata?.labels || {}).map(([key, value]) => `${key}=${value}`)
    const text = [item.metadata?.name, phaseOf(item), ...labels].join(' ').toLowerCase()
    return text.includes(query)
      && (!filters.phase || phaseOf(item) === filters.phase)
      && (!filters.server || serverNames(item).includes(filters.server))
      && (!labelQuery || labels.some(label => label.toLowerCase().includes(labelQuery)))
  })
}

export function certificateHealth(item, now = Date.now()) {
  if (item.kind !== 'SSHCertificate') return null
  const expiry = Date.parse(item.status?.validBefore)
  const begins = Date.parse(item.status?.validAfter)
  const renewal = Date.parse(item.status?.renewAt)
  if (!Number.isFinite(expiry)) return { label: 'Expiry unknown', color: 'gray' }
  if (expiry <= now) return { label: 'Expired', color: 'red' }
  if (Number.isFinite(begins) && begins > now) return { label: 'Not yet valid', color: 'yellow' }
  if (Number.isFinite(renewal) && renewal <= now) return { label: 'Renewal due', color: 'yellow' }
  return { label: 'Within validity window', color: 'green' }
}

export function trustHealth(item) {
  const status = item.status || {}
  const desired = item.kind === 'Server' ? status.desiredSSHTrustBundleDigest : status.desiredTrustBundleDigest
  const observed = item.kind === 'Server' ? status.installedSSHTrustBundleDigest : status.completedBuild?.trustBundleDigest
  if (!['Server', 'ISO'].includes(item.kind)) return null
  if (!desired || !observed) return { label: 'Trust not reported', color: 'gray', desired, observed }
  return { label: desired === observed ? 'Trust digest matches' : 'Trust update pending', color: desired === observed ? 'green' : 'yellow', desired, observed }
}

export function statusDetails(item) {
  const status = item.status || {}
  const fields = ['currentStage', 'reason', 'message', 'startedAt', 'completedAt', 'sourceBootID', 'liveBootID', 'backendRunID', 'lastVerifiedAt', 'inputRevision', 'playbookRevision']
  const details = fields.filter(field => status[field]).map(field => ({ label: humanize(field), value: String(status[field]) }))
  if (status.hostSSH?.message) details.push({ label: 'Host SSH', value: status.hostSSH.message })
  return details
}

/** Use the provider's URL, not a hardcoded CI hostname or guessed build number. */
export function concourseLinks(provider, externalName, buildID) {
  if (provider?.type !== 'concourse') return []
  let base
  try {
    base = new URL(provider.url)
    if (!['http:', 'https:'].includes(base.protocol) || base.username || base.password) return []
  } catch { return [] }
  const root = base.href.replace(/[?#].*$/, '').replace(/\/$/, '')
  const links = []
  if (externalName) links.push({ label: 'Concourse pipeline', url: `${root}/teams/${encodeURIComponent(provider.team || 'main')}/pipelines/${encodeURIComponent(externalName)}` })
  // Concourse build IDs are global IDs. UUID image IDs and "manual" are not builds.
  if (/^[1-9][0-9]*$/.test(String(buildID || ''))) links.push({ label: `Concourse build ${buildID}`, url: `${root}/builds/${buildID}` })
  return links
}

export async function executionLinks(item, resources, apiFetch, signal) {
  async function resolve(kind, reference) {
    if (!reference?.name) return null
    const resource = resources.find(candidate => candidate.kind === kind)
    if (!resource) return null
    const { body } = await apiFetch(`${resource.path}/${encodeURIComponent(reference.name)}`, { signal })
    if (reference.uid && reference.uid !== body.metadata.uid) throw new Error(`${kind}/${reference.name} was replaced.`)
    return body
  }
  const pipeline = item.kind === 'Pipeline' ? item : await resolve('Pipeline', item.status?.pipelineRef)
  const pinnedProvider = item.kind === 'Command' ? item.status?.snapshot?.provider : null
  const provider = pinnedProvider || (await resolve('PipelineProvider', pipeline?.spec?.providerRef))?.spec
  return concourseLinks(provider, pipeline?.spec?.externalName, item.status?.buildID)
}

/** UID-bound reads reject replacement Machines and partitions for other Servers. */
export async function loadServerStorage(server, resources, apiFetch, signal) {
  const machineResource = resources.find(resource => resource.kind === 'Machine')
  const partitionResource = resources.find(resource => resource.kind === 'DiskPartition')
  const reference = server.status?.machineRef
  const [machineResponse, partitionResponse] = await Promise.all([
    reference?.name && machineResource ? apiFetch(`${machineResource.path}/${encodeURIComponent(reference.name)}`, { signal }) : null,
    partitionResource ? apiFetch(partitionResource.path, { signal }) : null,
  ])
  const machine = machineResponse?.body
  if (reference && machine && (!reference.uid || machine.metadata.uid !== reference.uid)) throw new Error('Machine binding changed. Refresh the Server.')
  const partitions = (partitionResponse?.body.items || []).filter(partition =>
    !partition.metadata.deletionTimestamp && partition.spec.serverRef.name === server.metadata.name
    && (!partition.spec.serverRef.uid || partition.spec.serverRef.uid === server.metadata.uid))
  return { machine, partitions: partitions.sort((first, second) => first.spec.number - second.spec.number) }
}
