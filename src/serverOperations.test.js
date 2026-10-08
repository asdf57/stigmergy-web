import assert from 'node:assert/strict'
import { test } from 'node:test'
import { agentPulse, executorContainsServer, rebootBlockReason, requestServerReboot } from './serverOperations.js'

const server = () => ({ metadata: { name: 'node', uid: 'server-uid' }, spec: {}, status: { machineRef: { name: 'machine', uid: 'machine-uid' }, hostSSH: { phase: 'Ready' }, networking: { management: { address: { address: '10.1.1.2' } } } } })
const executor = () => ({ metadata: { name: 'servers', uid: 'executor-uid', generation: 1 }, spec: { inventoryCaptureGroupRef: { name: 'group' } }, status: { phase: 'Ready', observedGeneration: 1 } })
const group = () => ({ metadata: { name: 'group', uid: 'group-uid', generation: 1 }, status: { observedGeneration: 1, inventory: { all: { hosts: { node: {}, other: {} } } } } })

test('heartbeat freshness is timestamp-derived, not stored reachable', () => {
  const item = server(); const now = Date.parse('2026-10-08T12:00:00Z')
  assert.equal(agentPulse(item, now).label, 'Never seen')
  item.status.agent = { reachable: false, lastSeenTime: '2026-10-08T11:59:50Z' }
  assert.equal(agentPulse(item, now).label, 'Reporting')
  assert.equal(agentPulse(item, now + 120001).label, 'Stale')
  item.status.agent.lastSeenTime = '2026-10-08T15:00:00Z'
  assert.equal(agentPulse(item, now).label, 'Unknown')
  item.status.agent.lastSeenTime = 'invalid'
  assert.equal(agentPulse(item, now).label, 'Unknown')
})

test('deleting, unbound, paused, reserved and SSH-unready Servers cannot reboot', () => {
  assert.equal(rebootBlockReason(server()), '')
  for (const mutate of [item => { item.metadata.deletionTimestamp = 'now' }, item => { delete item.status.machineRef }, item => { item.spec.reconciliation = { paused: true } }, item => { item.status.provisioning = { activeRunRef: {} } }, item => { item.status.provisioning = { maintenance: true } }, item => { item.status.hostSSH.phase = 'Pending' }]) {
    const item = server(); mutate(item); assert.ok(rebootBlockReason(item))
  }
})

test('executor must currently capture the selected Server', () => {
  assert.ok(executorContainsServer(executor(), group(), server()))
  const stale = group(); stale.status.observedGeneration = 0
  assert.equal(executorContainsServer(executor(), stale, server()), false)
  const missing = group(); delete missing.status.inventory.all.hosts.node
  assert.equal(executorContainsServer(executor(), missing, server()), false)
})

test('reboot creates a UID-bound ordinary Command, never patches Server or provisions', async () => {
  const calls = []
  await requestServerReboot(async (path, options) => {
    calls.push([path, options])
    if (!options) return { body: path.endsWith('/node') ? server() : path.includes('commands-pipelines') ? executor() : group() }
    assert.equal(path, '/api/v1alpha1/commands')
    assert.equal(options.method, 'POST')
    const command = JSON.parse(options.body)
    assert.equal(command.kind, 'Command')
    assert.deepEqual(command.spec.commandsPipelineRef, { name: 'servers', uid: 'executor-uid' })
    assert.match(command.spec.script, /system_operations.py" reboot --server 'node' --uid 'server-uid' --machine-uid 'machine-uid'/)
    assert.doesNotMatch(command.spec.script, /ssh |systemctl|provisioning/)
  }, '/api/v1alpha1/servers', server(), executor(), 'node', 'reboot-test')
  assert.equal(calls.filter(([, options]) => options).length, 1)
})

test('wrong confirmation sends nothing; replaced identity and maintenance cannot POST', async () => {
  await assert.rejects(requestServerReboot(() => assert.fail('must not fetch'), '/api/v1alpha1/servers', server(), executor(), 'wrong'))
  for (const mutate of [item => { item.metadata.uid = 'replacement' }, item => { item.status.machineRef.uid = 'replacement' }, item => { item.status.provisioning = { maintenance: true } }]) {
    const item = server(); mutate(item)
    await assert.rejects(requestServerReboot(async (_, options) => { assert.equal(options, undefined); return { body: item } }, '/api/v1alpha1/servers', server(), executor(), 'node'))
  }
})

test('Command creation conflicts are not automatically retried', async () => {
  let writes = 0
  await assert.rejects(requestServerReboot(async (path, options) => {
    if (!options) return { body: path.endsWith('/node') ? server() : path.includes('commands-pipelines') ? executor() : group() }
    writes++; throw new Error('Conflict')
  }, '/api/v1alpha1/servers', server(), executor(), 'node', 'run'), /Conflict/)
  assert.equal(writes, 1)
})
