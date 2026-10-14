const clusterLabel = 'homelab.io/kube-cluster'
const roleLabel = 'homelab.io/kube-role'
const observationMaxAge = 15 * 60 * 1000

/** Current membership is independent of the last fully verified setup snapshot. */
function membershipObservation(cluster, configurations, now) {
  const observation = cluster.status?.observation
  const timestamp = Date.parse(observation?.observedAt)
  const fields = ['missingMembers', 'notReadyMembers', 'unexpectedNodes', 'identityConflicts']
  if (!observation || !Number.isFinite(timestamp) || timestamp > now + 5000
      || typeof observation.membership?.ready !== 'boolean'
      || !fields.every(field => Array.isArray(observation.membership[field])
        && observation.membership[field].every(value => typeof value === 'string' && value))) return null
  const configuration = configurations.find(value => value.metadata.uid === observation.configurationRef?.uid
    && value.metadata.name === observation.configurationRef?.name)
  const fresh = now - timestamp <= observationMaxAge
    && observation.observedGeneration === cluster.metadata.generation
    && configuration?.metadata.generation === observation.configurationGeneration
    && configuration?.status?.inputRevision === observation.inputRevision
    && configuration?.status?.playbookRevision === observation.playbookRevision
  return { ...observation, timestamp, fresh, configuration }
}

/** Cluster selection is independent of inventory capture membership. */
export function clusterMembers(cluster, servers) {
  return servers
    .filter(server => server.kind === 'Server'
      && server.metadata?.labels?.[clusterLabel] === cluster.metadata.name)
    .map(server => ({
      server,
      role: server.metadata.labels[roleLabel] || 'unknown',
      nodeName: server.metadata.annotations?.['homelab.io/kube-node-name'] || server.metadata.name,
      bindingConflict: Boolean(server.metadata.annotations?.['homelab.io/kube-cluster-uid']
        && server.metadata.annotations['homelab.io/kube-cluster-uid'] !== cluster.metadata.uid),
    }))
    .sort((first, second) => first.role === second.role
      ? first.server.metadata.name.localeCompare(second.server.metadata.name)
      : first.role.localeCompare(second.role))
}

/** Accept public observations only for this resolved cluster lifetime. */
function recordedVerification(cluster, configurations, now) {
  const status = cluster.status || {}
  const timestamp = Date.parse(status.lastVerifiedAt)
  const validNodes = Array.isArray(status.nodes) && status.nodes.every(node => node
    && typeof node.ready === 'boolean'
    && ['nodeUID', 'nodeName', 'role', 'internalIP', 'podCIDR', 'kubeletVersion', 'containerdVersion']
      .every(field => typeof node[field] === 'string' && node[field])
    && typeof node.serverRef?.name === 'string' && node.serverRef.name
    && typeof node.serverRef?.uid === 'string' && node.serverRef.uid
    && ['control-plane', 'worker'].includes(node.role))
  if (typeof status.clusterNamespaceUID !== 'string' || !status.clusterNamespaceUID
      || typeof status.configurationRef?.name !== 'string' || !status.configurationRef.name
      || typeof status.configurationRef?.uid !== 'string' || !status.configurationRef.uid
      || !Number.isFinite(timestamp) || timestamp > now + 5000 || !validNodes) return null
  const configuration = configurations.find(candidate => candidate.metadata.uid === status.configurationRef.uid
    && candidate.metadata.name === status.configurationRef.name) || null
  return { configuration, observations: status, timestamp }
}

function membershipMatches(members, verification) {
  return members.length === verification.observations.nodes.length && members.every(member =>
    !member.bindingConflict && !member.server.metadata.deletionTimestamp
    && verification.observations.nodes.filter(node => node.serverRef.uid === member.server.metadata.uid
      && node.serverRef.name === member.server.metadata.name && node.nodeName === member.nodeName
      && node.role === member.role).length === 1)
}

/** Rechecking/busy phases do not turn an old successful observation into live health. */
export function clusterOverview(cluster, servers, configurations, now = Date.now()) {
  const members = clusterMembers(cluster, servers)
  const setups = configurations.filter(configuration => configuration.kind === 'Configuration'
    && !configuration.metadata?.deletionTimestamp
    && configuration.spec?.targetRef?.kind === 'KubeCluster'
    && configuration.spec.targetRef.name === cluster.metadata.name)
  const verification = recordedVerification(cluster, setups, now)
  const observation = membershipObservation(cluster, setups, now)
  if (observation?.fresh && !members.every(member =>
    observation.configuration.status?.resolvedReferences?.some(reference =>
      reference.kind === 'Server' && reference.name === member.server.metadata.name
      && reference.uid === member.server.metadata.uid
      && reference.generation === member.server.metadata.generation))) observation.fresh = false
  const issues = []
  const controlPlanes = members.filter(member => member.role === 'control-plane')
  if (controlPlanes.length !== 1) issues.push(`V1 requires one control plane; ${controlPlanes.length} are selected.`)
  if (members.some(member => !['control-plane', 'worker'].includes(member.role))) issues.push('Some members have an unsupported Kubernetes role.')
  if (members.some(member => member.bindingConflict)) issues.push('A Server annotation refers to another cluster lifetime.')
  if (new Set(members.map(member => member.nodeName)).size !== members.length) issues.push('Desired Kubernetes node names are not unique.')
  if (cluster.status?.lastVerifiedAt && !verification) issues.push('The cluster observation is incomplete or invalid; no verified snapshot is shown.')
  const matches = verification ? membershipMatches(members, verification) : false
  const observed = verification?.observations
  const configuration = verification?.configuration
  const settingsMatch = verification && observed.observedGeneration === cluster.metadata.generation
    && ['kubernetesVersion', 'containerdVersion', 'controlPlaneEndpoint', 'podCIDR', 'serviceCIDR']
      .every(field => observed[field] === cluster.spec[field])
    && observed.network?.provider === cluster.spec.network?.provider
    && observed.network?.version === cluster.spec.network?.version
  const current = Boolean(verification && configuration && matches && settingsMatch && issues.length === 0
    && now - verification.timestamp <= observationMaxAge
    && configuration.status?.phase !== 'Failed'
    && (!observation || (observation.fresh && observation.membership.ready))
    && observed.configurationGeneration === configuration.metadata.generation
    && observed.inputRevision === configuration.status?.inputRevision
    && observed.playbookRevision === configuration.status?.playbookRevision
    && members.every(member => configuration.status?.resolvedReferences?.some(reference =>
      reference.kind === 'Server' && reference.uid === member.server.metadata.uid
      && reference.name === member.server.metadata.name && reference.generation === member.server.metadata.generation)))
  const unmatchedNodes = observed?.nodes.filter(node => !members.some(member =>
    member.server.metadata.uid === node.serverRef.uid && member.nodeName === node.nodeName && member.role === node.role)) || []
  return { members, setups, verification, observation, current, issues, unmatchedNodes,
    settingsMatch: Boolean(settingsMatch), membershipMatches: matches,
    controlPlanes, workers: members.filter(member => member.role === 'worker') }
}

/** Read through discovered same-origin routes only; no cluster calls or credential reads. */
export async function loadClusterOverview(cluster, resources, apiFetch, signal) {
  function route(kind) {
    const resource = resources.find(candidate => candidate.kind === kind)
    if (!resource) throw new Error(`${kind} is not available in the API catalog.`)
    return resource.path
  }
  const [clusterResponse, serverResponse, configurationResponse] = await Promise.all([
    apiFetch(`${route('KubeCluster')}/${encodeURIComponent(cluster.metadata.name)}`, { signal }),
    apiFetch(route('Server'), { signal }),
    apiFetch(route('Configuration'), { signal }),
  ])
  const latest = clusterResponse.body
  if (latest.kind !== 'KubeCluster' || latest.metadata?.uid !== cluster.metadata.uid
      || latest.metadata?.name !== cluster.metadata.name) throw new Error('Cluster identity changed. Refresh this page.')
  if (!Array.isArray(serverResponse.body?.items) || !Array.isArray(configurationResponse.body?.items)) {
    throw new Error('The API returned an incomplete resource collection.')
  }
  return { cluster: latest, servers: serverResponse.body.items, configurations: configurationResponse.body.items }
}
