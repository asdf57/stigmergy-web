import assert from 'node:assert/strict'
import { test } from 'node:test'
import { discoverResources, groupResources, referenceKinds } from './resourceCatalog.js'

function apiFixture(kinds) {
  const spec = { paths: {}, components: { schemas: {} } }
  for (const kind of kinds) {
    const path = `/api/v1alpha1/${kind.toLowerCase()}s`
    spec.paths[path] = {
      get: {},
      post: { requestBody: { content: { 'application/json': { schema: { $ref: `#/components/schemas/${kind}Create` } } } } },
    }
    spec.paths[`${path}/{name}`] = { get: {}, delete: {}, ...(kind === 'ProvisioningRun' || kind === 'Command' ? {} : { put: {} }) }
    spec.components.schemas[`${kind}Create`] = { properties: {
      kind: { const: kind }, apiVersion: { const: 'homelab.io/v1alpha1' },
      spec: { $ref: `#/components/schemas/${kind}Spec` },
    } }
  }
  return spec
}

test('every current API resource appears in navigation exactly once', () => {
  const kinds = [
    'Command', 'CommandsPipeline', 'DiskPartition', 'DNSRecord', 'GitRepository',
    'InventoryCaptureGroup', 'InventoryPublication', 'ISO', 'Machine', 'MachineReport',
    'Pipeline', 'PipelineProvider', 'ProvisioningRun', 'Router', 'Secret', 'SecretStore',
    'Server', 'SSHCertificateAuthority', 'SSHCertificate', 'SSHKeyPair',
    'UsernamePasswordCredential', 'FutureResource',
  ]
  const resources = discoverResources(apiFixture(kinds))
  const groups = groupResources(resources)
  const visibleKinds = groups.flatMap((group) => group.resources.map((resource) => resource.kind))
  assert.deepEqual(visibleKinds.sort(), kinds.sort())
  assert.equal(new Set(visibleKinds).size, kinds.length)
  assert.deepEqual(groups.find((group) => group.label === 'Other resources').resources.map((resource) => resource.kind), ['FutureResource'])
})

test('immutable requests are viewable and deletable, but not editable', () => {
  const fixture = apiFixture(['ProvisioningRun', 'Command', 'DiskPartition'])
  // Command exposes PUT for idempotent replacement, but its spec is immutable.
  fixture.paths['/api/v1alpha1/commands/{name}'].put = { description: "This resource's spec is immutable after creation." }
  const resources = discoverResources(fixture)
  for (const resource of resources) {
    assert.equal(resource.canEdit, resource.kind === 'DiskPartition')
    assert.equal(resource.canDelete, true)
    assert.equal(resource.specSchema, `${resource.kind}Spec`)
  }
})

test('new resource references resolve to the correct catalog', () => {
  assert.equal(referenceKinds.serverRef, 'Server')
  assert.equal(referenceKinds.machineRef, 'Machine')
  assert.equal(referenceKinds.partitionRefs, 'DiskPartition')
  assert.equal(referenceKinds.authorityRef, 'SSHCertificateAuthority')
  assert.equal(referenceKinds.keyPairRef, 'SSHKeyPair')
  assert.equal(referenceKinds.commandsPipelineRef, 'CommandsPipeline')
})

test('status and parameterized paths do not become resource collections', () => {
  const spec = apiFixture(['Server'])
  spec.paths['/readyz'] = { get: {}, post: {} }
  spec.paths['/api/v1alpha1/servers/{name}/status'] = { get: {}, post: {} }
  assert.deepEqual(discoverResources(spec).map((resource) => resource.kind), ['Server'])
})
