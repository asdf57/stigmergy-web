// OpenAPI is authoritative for available resources and supported operations.
export const resourceGroups = [
  { label: 'Infrastructure', kinds: ['Machine', 'MachineReport', 'Server', 'Router', 'DNSRecord', 'DiskPartition', 'KubeCluster'] },
  { label: 'Automation', kinds: ['ISO', 'Pipeline', 'PipelineProvider', 'CommandsPipeline', 'Command', 'ProvisioningRun', 'Configuration', 'Operation'] },
  { label: 'Inventory', kinds: ['InventoryCaptureGroup', 'InventoryPublication', 'GitRepository'] },
  { label: 'Security', kinds: ['SecretStore', 'Secret', 'SSHKeyPair', 'SSHCertificateAuthority', 'SSHCertificate', 'UsernamePasswordCredential'] },
]

export const referenceKinds = {
  kubeClusterRef: 'KubeCluster',
  operationRef: 'Operation',
  dependsOn: 'Configuration',
  authorizedKeyRefs: 'SSHKeyPair',
  commandsRepositoryRef: 'GitRepository',
  commandsPipelineRef: 'CommandsPipeline',
  credentialRef: 'UsernamePasswordCredential',
  inventoryCaptureGroupRef: 'InventoryCaptureGroup',
  pipelineProviderRef: 'PipelineProvider',
  providerRef: 'PipelineProvider',
  secretStoreRef: 'SecretStore',
  sshKeyPairRef: 'SSHKeyPair',
  keyPairRef: 'SSHKeyPair',
  signingKeyRef: 'SSHKeyPair',
  trustedKeyRefs: 'SSHKeyPair',
  sshCertificateAuthorityRef: 'SSHCertificateAuthority',
  authorityRef: 'SSHCertificateAuthority',
  repositoryRef: 'GitRepository',
  isoRef: 'ISO',
  serverRef: 'Server',
  machineRef: 'Machine',
  partitionRefs: 'DiskPartition',
}

export const humanize = (value = '') => value
  .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
  .replace(/[-_]+/g, ' ')
  .replace(/\b\w/g, (letter) => letter.toUpperCase())

const pluralLabel = (kind) => kind.endsWith('y')
  ? `${humanize(kind.slice(0, -1))}ies`
  : kind.endsWith('s') ? `${humanize(kind)}es` : `${humanize(kind)}s`

export function discoverResources(spec) {
  return Object.entries(spec.paths || {}).flatMap(([path, collection]) => {
    if (!path.startsWith('/api/') || path.includes('{') || !collection.post || !collection.get) return []
    const createSchema = collection.post.requestBody?.content?.['application/json']?.schema?.$ref?.split('/').pop()
    const schema = spec.components?.schemas?.[createSchema]
    const kind = schema?.properties?.kind?.const || collection.post.operationId?.replace(/^create/, '')
    if (!kind) return []
    const itemRoute = spec.paths[`${path}/{name}`] || {}
    const specSchema = schema?.properties?.spec?.$ref?.split('/').pop()
    const editDescription = [itemRoute.put?.description, spec.components?.schemas?.[specSchema]?.description].join(' ')
    return [{
      kind, label: pluralLabel(kind), path, slug: path.split('/').pop(), createSchema,
      specSchema,
      apiVersion: schema?.properties?.apiVersion?.const || 'homelab.io/v1alpha1',
      canEdit: Boolean(itemRoute.put) && !/\bimmutable\b/i.test(editDescription),
      canDelete: Boolean(itemRoute.delete),
    }]
  }).sort((first, second) => first.label.localeCompare(second.label))
}

// A new API kind must never disappear just because navigation has no category yet.
export function groupResources(resources) {
  const groupedKinds = new Set(resourceGroups.flatMap((group) => group.kinds))
  return [
    ...resourceGroups.map((group) => ({
      label: group.label,
      resources: resources.filter((resource) => group.kinds.includes(resource.kind)),
    })),
    { label: 'Other resources', resources: resources.filter((resource) => !groupedKinds.has(resource.kind)) },
  ].filter((group) => group.resources.length > 0)
}
