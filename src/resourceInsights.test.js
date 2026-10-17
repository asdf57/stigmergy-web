import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  certificateHealth, concourseLinks, executionLinks, filterResources,
  loadServerStorage, resourceReferences, statusDetails, trustHealth,
} from './resourceInsights.js'

const resources = [
  ['Server', 'servers'], ['Machine', 'machines'], ['DiskPartition', 'disk-partitions'],
  ['Pipeline', 'pipelines'], ['PipelineProvider', 'pipeline-providers'],
].map(([kind, slug]) => ({ kind, slug, path: `/api/v1alpha1/${slug}` }))
const server = () => ({ kind: 'Server', metadata: { name: 'zima', uid: 'server-uid' },
  status: { machineRef: { name: 'node', uid: 'machine-uid' } } })
const partition = (name, serverName = 'zima', uid = 'server-uid') => ({
  kind: 'DiskPartition', metadata: { name, uid: name },
  spec: { serverRef: { name: serverName, uid }, number: 3 },
})

test('Configuration exposes resolved status identities and actual source commit', () => {
  const commit = 'a'.repeat(40)
  const item = { kind: 'Configuration', spec: { targetRef: { kind: 'KubeCluster', name: 'lab' } },
    status: { sourceRevision: commit, resolvedReferences: [
      { kind: 'KubeCluster', name: 'lab', uid: 'cluster-uid', generation: 1 },
    ] } }
  assert.deepEqual(resourceReferences(item).map(ref => ref.uid), [undefined, 'cluster-uid'])
  assert.equal(statusDetails(item).find(detail => detail.label === 'Source Revision').value, commit)
})

test('references include pinned relationships but never arbitrary secret data or snapshot inputs', () => {
  const item = { spec: { serverRef: { name: 'zima', uid: 's' }, partitionRefs: [{ name: 'root' }, { name: 'efi' }],
    data: { serverRef: { name: 'private' } } }, status: { snapshot: {
      isoRef: { name: 'debian' }, inputs: { serverRef: { name: 'hidden' } },
    }, lastSuccessfulRunRef: { name: 'run', uid: 'r' } } }
  assert.deepEqual(resourceReferences(item).map(reference => reference.name), ['zima', 'root', 'efi', 'debian', 'run'])
  assert.equal(resourceReferences(item)[0].uid, 's')
})

test('query, Server, phase and label filters combine, without mutating resources', () => {
  const items = [partition('root'), partition('other', 'beelink')]
  items[0].metadata.labels = { cluster: 'lab' }
  items[0].status = { phase: 'Ready' }
  items[1].status = { phase: 'Failed' }
  const before = JSON.stringify(items)
  const phaseOf = item => item.status.phase
  assert.deepEqual(filterResources(items, { server: 'zima', phase: 'Ready', label: 'cluster=lab', query: 'root' }, phaseOf), [items[0]])
  assert.deepEqual(filterResources(items, { phase: 'Failed', server: 'zima' }, phaseOf), [])
  assert.equal(JSON.stringify(items), before)
})

test('certificate validity distinguishes unknown, expired, future and renewal due', () => {
  const now = Date.parse('2026-10-11T10:00:00Z')
  const certificate = status => certificateHealth({ kind: 'SSHCertificate', status }, now).label
  assert.equal(certificate({}), 'Expiry unknown')
  assert.equal(certificate({ validBefore: 'bad' }), 'Expiry unknown')
  assert.equal(certificate({ validBefore: '2026-10-11T10:00:00Z' }), 'Expired')
  assert.equal(certificate({ validBefore: '2026-10-12T10:00:00Z', validAfter: '2026-10-11T11:00:00Z' }), 'Not yet valid')
  assert.equal(certificate({ validBefore: '2026-10-12T10:00:00Z', renewAt: '2026-10-11T09:00:00Z' }), 'Renewal due')
  assert.equal(certificate({ validBefore: '2026-10-12T10:00:00Z', renewAt: '2026-10-12T09:00:00Z' }), 'Within validity window')
})

test('trust comparison requires both reported digests and uses the completed ISO, not desired state', () => {
  assert.equal(trustHealth(server()).label, 'Trust not reported')
  assert.equal(trustHealth({ kind: 'Server', status: { desiredSSHTrustBundleDigest: 'a', installedSSHTrustBundleDigest: 'b' } }).label, 'Trust update pending')
  assert.equal(trustHealth({ kind: 'ISO', status: { desiredTrustBundleDigest: 'a', completedBuild: { trustBundleDigest: 'a' } } }).label, 'Trust digest matches')
})

test('build links use global IDs, URL-encode paths and reject unsafe provider URLs', () => {
  const provider = { type: 'concourse', url: 'https://ci.example/base/', team: 'my team' }
  assert.deepEqual(concourseLinks(provider, 'install/nodes', 123), [
    { label: 'Concourse pipeline', url: 'https://ci.example/base/teams/my%20team/pipelines/install%2Fnodes' },
    { label: 'Concourse build 123', url: 'https://ci.example/base/builds/123' },
  ])
  assert.deepEqual(concourseLinks(provider, '', 'manual'), [])
  assert.deepEqual(concourseLinks(provider, '', 'image-uuid'), [])
  for (const url of ['javascript:alert(1)', 'https://user:password@example/', 'file:///tmp/ci']) {
    assert.deepEqual(concourseLinks({ ...provider, url }, 'install', 123), [])
  }
})

test('execution links resolve provider/pipeline with GET only and reject replaced UIDs', async () => {
  const calls = []
  const apiFetch = async (path, options) => {
    assert.equal(options.method, undefined)
    calls.push(path)
    return { body: path.endsWith('/pipeline')
      ? { metadata: { uid: 'pipeline-uid' }, spec: { externalName: 'commands', providerRef: { name: 'ci' } } }
      : { metadata: { uid: 'ci-uid' }, spec: { type: 'concourse', url: 'https://ci.example' } } }
  }
  const command = { kind: 'Command', status: { buildID: 123, pipelineRef: { name: 'pipeline', uid: 'pipeline-uid' } } }
  assert.equal((await executionLinks(command, resources, apiFetch))[1].url, 'https://ci.example/builds/123')
  assert.equal(calls.length, 2)
  command.status.pipelineRef.uid = 'replaced'
  await assert.rejects(executionLinks(command, resources, apiFetch), /was replaced/)
  assert.deepEqual(await executionLinks({ kind: 'ProvisioningRun', status: { backendRunID: 'manual' } }, resources, apiFetch), [])
})

test('storage reads reject replaced Machines and exclude other Server layouts and deleted partitions', async () => {
  const deleting = partition('deleted'); deleting.metadata.deletionTimestamp = 'now'
  const apiFetch = async (path, options) => {
    assert.equal(options.method, undefined)
    return { body: path.includes('/machines/') ? { metadata: { uid: 'machine-uid' }, status: {} }
      : { items: [partition('root'), partition('other', 'beelink'), partition('stale', 'zima', 'old'), deleting] } }
  }
  const result = await loadServerStorage(server(), resources, apiFetch)
  assert.deepEqual(result.partitions.map(item => item.metadata.name), ['root'])
  const replaced = server(); replaced.status.machineRef.uid = 'old'
  await assert.rejects(loadServerStorage(replaced, resources, apiFetch), /binding changed/)
  assert.equal((await loadServerStorage({ ...server(), status: {} }, resources, apiFetch)).machine, undefined)
})

test('status summaries whitelist diagnostics rather than dumping execution snapshots', () => {
  const details = statusDetails({ status: { currentStage: 'Installing', message: 'disk check failed', snapshot: { private: 'hidden' }, hostSSH: { message: 'key mismatch' } } })
  assert.deepEqual(details.map(detail => detail.value), ['Installing', 'disk check failed', 'key mismatch'])
})
