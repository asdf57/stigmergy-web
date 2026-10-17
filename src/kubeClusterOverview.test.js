import assert from 'node:assert/strict'
import test from 'node:test'
import { clusterOverview, loadClusterOverview } from './kubeClusterOverview.js'

function fixtures() {
  const spec = { kubernetesVersion: '1.37.1', containerdVersion: '2.4.1',
    controlPlaneEndpoint: 'lab.example:6443', podCIDR: '172.28.0.0/16', serviceCIDR: '172.29.0.0/16',
    network: { provider: 'flannel', version: '0.28.10' } }
  const servers = [{ kind: 'Server', metadata: { name: 'zima', uid: 'server-uid', generation: 1,
    labels: { 'homelab.io/kube-cluster': 'lab', 'homelab.io/kube-role': 'control-plane' } } }]
  const configurations = [{ kind: 'Configuration', metadata: { name: 'setup', uid: 'setup-uid', generation: 1 },
    spec: { targetRef: { kind: 'KubeCluster', name: 'lab' } }, status: { phase: 'Reconciling',
      inputRevision: 'revision', sourceRevision: 'commit', resolvedReferences: [
        { kind: 'Server', name: 'zima', uid: 'server-uid', generation: 1 }] } }]
  const cluster = { kind: 'KubeCluster', metadata: { name: 'lab', uid: 'cluster-uid', generation: 1 }, spec,
    status: { ...structuredClone(spec), observedGeneration: 1,
      lastVerifiedAt: '2026-10-13T00:00:00Z', configurationRef: { name: 'setup', uid: 'setup-uid' },
      configurationGeneration: 1, inputRevision: 'revision', playbookRevision: 'commit',
      clusterNamespaceUID: 'namespace-uid', checks: { serviceDNS: true, podConnectivity: true },
      nodes: [{ serverRef: { name: 'zima', uid: 'server-uid' }, nodeName: 'zima', nodeUID: 'node-uid',
        role: 'control-plane', ready: true, internalIP: '192.0.2.1', podCIDR: '172.28.0.0/24',
        kubeletVersion: 'v1.37.1', containerdVersion: '2.4.1' }] } }
  return { cluster, servers, configurations }
}

const now = Date.parse('2026-10-13T00:05:00Z')
function overview(fixture) {
  return clusterOverview(fixture.cluster, fixture.servers, fixture.configurations, now)
}

test('cluster status is the domain snapshot even while Configuration rechecks', () => {
  const fixture = fixtures()
  assert.equal(overview(fixture).current, true)
  assert.equal(overview(fixture).verification.observations.nodes[0].nodeUID, 'node-uid')
})

test('configuration outputs never substitute for absent cluster observations', () => {
  const fixture = fixtures()
  fixture.configurations[0].status.outputs = structuredClone(fixture.cluster.status)
  fixture.cluster.status = {}
  assert.equal(overview(fixture).verification, null)
  assert.equal(overview(fixture).current, false)
})

test('changed desired generation and replaced Server keep snapshot explicitly historical', () => {
  const fixture = fixtures()
  fixture.cluster.metadata.generation = 2
  assert.equal(overview(fixture).current, false)
  assert.notEqual(overview(fixture).verification, null)
  fixture.servers[0].metadata.uid = 'replacement'
  assert.equal(overview(fixture).membershipMatches, false)
  assert.equal(overview(fixture).unmatchedNodes.length, 1)
})

test('replacement reporting Configuration cannot claim an old observation', () => {
  const fixture = fixtures()
  fixture.configurations[0].metadata.uid = 'replacement'
  assert.equal(overview(fixture).verification.configuration, null)
  assert.equal(overview(fixture).current, false)
})

test('old successful snapshot cannot appear current', () => {
  const fixture = fixtures()
  const result = clusterOverview(fixture.cluster, fixture.servers, fixture.configurations,
    Date.parse('2026-10-13T01:00:00Z'))
  assert.equal(result.current, false)
  assert.notEqual(result.verification, null)
})

test('negative current observation takes precedence over a previous success', () => {
  const fixture = fixtures()
  fixture.cluster.status.observation = {
    observedAt: '2026-10-13T00:04:00Z', observedGeneration: 1,
    configurationRef: {name: 'setup', uid: 'setup-uid'}, configurationGeneration: 1,
    inputRevision: 'revision', playbookRevision: 'commit',
    membership: {ready: false, missingMembers: ['zima'], notReadyMembers: [], unexpectedNodes: [], identityConflicts: []},
  }
  const result = overview(fixture)
  assert.equal(result.observation.fresh, true)
  assert.equal(result.current, false)
  assert.deepEqual(result.observation.membership.missingMembers, ['zima'])
  assert.equal(result.verification.observations.nodes[0].ready, true)
  fixture.cluster.status.observation.observedAt = '2026-10-12T00:00:00Z'
  assert.equal(overview(fixture).observation.fresh, false)
})

test('invalid, incomplete and future observations are refused', () => {
  for (const mutate of [
    value => { value.cluster.status.nodes[0].ready = 'true' },
    value => { delete value.cluster.status.nodes[0].nodeUID },
    value => { value.cluster.status.lastVerifiedAt = '2027-01-01T00:00:00Z' },
  ]) {
    const fixture = fixtures()
    mutate(fixture)
    assert.equal(overview(fixture).verification, null)
    assert.equal(overview(fixture).current, false)
  }
})

test('overview reads only discovered generic resource routes and rejects replacement cluster', async () => {
  const fixture = fixtures()
  const resources = ['KubeCluster', 'Server', 'Configuration'].map(kind => ({ kind, path: '/' + kind }))
  const requests = []
  const fetch = async (path, options) => {
    requests.push([path, options])
    return { body: path.startsWith('/KubeCluster/') ? fixture.cluster
      : { items: path === '/Server' ? fixture.servers : fixture.configurations } }
  }
  await loadClusterOverview(fixture.cluster, resources, fetch)
  assert.deepEqual(requests.map(([path]) => path).sort(), ['/Configuration', '/KubeCluster/lab', '/Server'])
  assert.ok(requests.every(([, options]) => !options.method && !options.body))
  const prior = structuredClone(fixture.cluster)
  fixture.cluster.metadata.uid = 'replacement'
  await assert.rejects(loadClusterOverview(prior, resources, fetch), /identity changed/)
})
