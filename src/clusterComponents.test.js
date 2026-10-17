import assert from 'node:assert/strict'
import test from 'node:test'
import { clusterComponents, componentStatus } from './clusterComponents.js'

const now = Date.parse('2026-10-17T01:15:00Z')

function fixtures() {
  const cluster = { kind: 'KubeCluster', metadata: { name: 'lab', uid: 'cluster-uid', generation: 1 },
    status: { configurationRef: { name: 'setup', uid: 'setup-uid' } } }
  const setup = { kind: 'Configuration', metadata: { name: 'setup', uid: 'setup-uid', generation: 3 },
    spec: { targetRef: { kind: 'KubeCluster', name: 'lab' } } }
  const component = { kind: 'Configuration', metadata: { name: 'grafana', uid: 'grafana-uid', generation: 1 },
    spec: { targetRef: { kind: 'KubeCluster', name: 'lab' }, context: { kubeClusterRef: { name: 'lab' } }, dependsOn: [{ name: 'setup' }] },
    status: { phase: 'Ready', observedGeneration: 1, lastVerifiedAt: '2026-10-17T01:13:00Z', resolvedReferences: [
      { kind: 'KubeCluster', ...cluster.metadata }, { kind: 'Configuration', ...setup.metadata },
    ] } }
  return { cluster, setup, component, configurations: [setup, component] }
}

test('components are separated from the reporting setup and sorted without mutating inputs', () => {
  const fixture = fixtures()
  const exporter = structuredClone(fixture.component)
  exporter.metadata = { name: 'exporter', uid: 'exporter-uid', generation: 1 }
  fixture.configurations.push(exporter)
  const before = JSON.stringify(fixture)
  assert.deepEqual(clusterComponents(fixture.cluster, fixture.configurations).map(value => value.metadata.name), ['exporter', 'grafana'])
  assert.equal(JSON.stringify(fixture), before)
})

test('direct and transitive setup dependencies select cluster-targeted components', () => {
  const fixture = fixtures()
  delete fixture.component.spec.context
  const dashboard = structuredClone(fixture.component)
  dashboard.metadata = { name: 'dashboards', uid: 'dashboards-uid', generation: 1 }
  dashboard.spec.dependsOn = [{ name: 'grafana' }]
  fixture.configurations.push(dashboard)
  assert.deepEqual(clusterComponents(fixture.cluster, fixture.configurations).map(value => value.metadata.name), ['dashboards', 'grafana'])
})

test('explicit context works before bootstrap reports, including non-cluster targets', () => {
  const fixture = fixtures()
  fixture.cluster.status = {}
  fixture.component.spec.targetRef = { kind: 'Server', name: 'node' }
  assert.deepEqual(clusterComponents(fixture.cluster, fixture.configurations), [fixture.component])
})

test('unrelated configurations and command names never imply cluster association', () => {
  const fixture = fixtures()
  fixture.component.spec.targetRef.name = 'other'
  fixture.component.spec.context.kubeClusterRef.name = 'other'
  fixture.component.spec.command = { argv: ['install-grafana-into-lab'] }
  assert.deepEqual(clusterComponents(fixture.cluster, fixture.configurations), [])
})

test('dependency cycles terminate and replaced setup names stay in the setup section', () => {
  const fixture = fixtures()
  delete fixture.component.spec.context
  fixture.component.spec.dependsOn = [{ name: 'grafana' }]
  fixture.setup.metadata.uid = 'replaced-setup'
  assert.deepEqual(clusterComponents(fixture.cluster, fixture.configurations), [])
})

test('Ready requires current observed generation, bound resource identities and recent verification', () => {
  const fixture = fixtures()
  const status = () => componentStatus(fixture.component, fixture.cluster, fixture.configurations, now)
  assert.deepEqual(status(), { label: 'Ready', color: 'green' })
  fixture.component.metadata.generation++
  assert.equal(status().label, 'Changes pending')
  fixture.component.metadata.generation--
  fixture.cluster.metadata.uid = 'replaced-cluster'
  assert.equal(status().label, 'Needs reconciliation')
  fixture.cluster.metadata.uid = 'cluster-uid'
  fixture.setup.metadata.uid = 'replaced-setup'
  assert.equal(status().label, 'Needs reconciliation')
  fixture.setup.metadata.uid = 'setup-uid'
  fixture.setup.metadata.generation++
  assert.equal(status().label, 'Needs reconciliation')
})

test('missing dependencies and unresolved observations do not show green', () => {
  const fixture = fixtures()
  assert.equal(componentStatus(fixture.component, fixture.cluster, [fixture.component], now).label, 'Needs reconciliation')
  fixture.component.status.resolvedReferences = []
  assert.equal(componentStatus(fixture.component, fixture.cluster, fixture.configurations, now).color, 'yellow')
  delete fixture.component.status.observedGeneration
  assert.equal(componentStatus(fixture.component, fixture.cluster, fixture.configurations, now).label, 'Not reported')
})

test('old, missing and future verification times are explicit', () => {
  const fixture = fixtures()
  for (const [timestamp, label] of [['2026-10-17T00:00:00Z', 'Verification stale'],
    [undefined, 'Not verified'], ['2027-01-01T00:00:00Z', 'Not verified']]) {
    fixture.component.status.lastVerifiedAt = timestamp
    assert.equal(componentStatus(fixture.component, fixture.cluster, fixture.configurations, now).label, label)
  }
})

test('failed, reconciling, waiting, suspended and deleting remain visible', () => {
  const fixture = fixtures()
  const status = () => componentStatus(fixture.component, fixture.cluster, fixture.configurations, now)
  fixture.component.status.phase = 'Failed'
  assert.deepEqual(status(), { label: 'Failed', color: 'red' })
  fixture.component.status.phase = 'Reconciling'
  assert.equal(status().label, 'Reconciling')
  fixture.component.status.phase = 'Pending'
  fixture.component.status.reason = 'DependencyPending'
  assert.equal(status().label, 'Waiting for dependencies')
  fixture.component.spec.suspended = true
  assert.equal(status().label, 'Suspended')
  fixture.component.metadata.deletionTimestamp = '2026-10-17T01:14:00Z'
  assert.equal(status().label, 'Deleting')
})
