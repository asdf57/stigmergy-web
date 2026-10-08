import assert from 'node:assert/strict'
import { test } from 'node:test'
import { diskDeviceID, provisionBlockReason, provisionDisks, provisioningTargets, requestServerProvision } from './serverProvisioning.js'

const server = () => ({ metadata: { name: 'beelink', uid: 'server-uid', generation: 1 }, spec: {
  provisioning: { enabled: true }, operatingSystem: { architecture: 'amd64', bootMode: 'uefi', distribution: 'arch', version: 'rolling' },
  boot: { isoRef: { name: 'live' } }, sshCertificateAuthorityRef: { name: 'ca' } },
  status: { machineRef: { name: 'machine', uid: 'machine-uid' }, hostSSH: { phase: 'Ready' }, provisioning: {} } })
const machine = () => ({ metadata: { name: 'machine', uid: 'machine-uid' }, status: { inventory: { storage: [
  { type: 'disk', serial: 'serial', wwn: '0x123', tran: 'sata', size: 512000000000 },
  { type: 'disk', serial: 'usb', tran: 'usb', size: 16000000000 },
] } } })

test('disk selection creates one immutable run, not a Server spec PATCH', async () => {
  const calls = []; const item = server()
  await requestServerProvision(async (...args) => { calls.push(args) }, '/api/v1alpha1/servers', item, machine(), 'wwn:0x123', 'beelink', 'run-1')
  assert.equal(calls.length, 1); assert.equal(calls[0][0], '/api/v1alpha1/provisioning-runs')
  assert.equal(calls[0][1].method, 'POST')
  const request = JSON.parse(calls[0][1].body)
  assert.deepEqual(request.spec, { serverRef: { name: 'beelink', uid: 'server-uid' }, serverGeneration: 1, machineRef: { name: 'machine', uid: 'machine-uid' }, storage: { disks: [{ deviceID: 'wwn:0x123', role: 'system' }] } })
  assert.deepEqual(item.spec.provisioning, { enabled: true })
})

test('unsafe selections and missing confirmation never send a request', async () => {
  for (const [hardware, id, confirmation] of [[machine(), 'serial:usb', 'beelink'], [machine(), '/dev/sda', 'beelink'], [machine(), 'wwn:0x123', 'wrong'], [{ ...machine(), metadata: { name: 'machine', uid: 'replacement' } }, 'wwn:0x123', 'beelink']]) {
    await assert.rejects(requestServerProvision(() => assert.fail('must not send'), '/api/v1alpha1/servers', server(), hardware, id, confirmation, 'run'))
  }
})

test('missing identities, USB and ambiguous disks are unavailable', () => {
  const value = machine(); value.status.inventory.storage.push(value.status.inventory.storage[0])
  assert.ok(provisionDisks(value).every(disk => !disk.eligible))
  assert.equal(diskDeviceID({ wwn: '0xABC' }), 'wwn:0xabc')
  assert.equal(diskDeviceID({ serial: 'ABC' }), 'serial:ABC')
  assert.equal(diskDeviceID({}), '')
})

test('reserved, disabled, paused and undiscovered Servers cannot request', () => {
  for (const mutate of [value => { value.status.provisioning.maintenance = true }, value => { value.status.provisioning.activeRunRef = {} }, value => { value.spec.provisioning.enabled = false }, value => { value.spec.reconciliation = { paused: true } }, value => { delete value.status.machineRef }, value => { value.status.hostSSH.phase = 'Pending' }]) {
    const value = server(); mutate(value); assert.ok(provisionBlockReason(value))
  }
})

test('conflicts are surfaced without automatic retries', async () => {
  let calls = 0
  await assert.rejects(requestServerProvision(async () => { calls++; throw new Error('Conflict') }, '/api/v1alpha1/servers', server(), machine(), 'wwn:0x123', 'beelink', 'run'), /Conflict/)
  assert.equal(calls, 1)
})

const iso = () => ({ metadata: { name: 'debian-live', uid: 'iso-uid', generation: 2 }, spec: { distribution: 'debian', version: 'trixie', architecture: 'amd64', bootMode: 'uefi' }, status: { phase: 'Ready', observedGeneration: 2, completedBuild: { id: 'build' } } })
const selection = () => { const targets = provisioningTargets([iso()]); return { targets, target: targets[0] } }

test('OS choices come from current Ready supported ISO resources only', () => {
  const images = [iso(), { ...iso(), status: { phase: 'Pending' } }, { ...iso(), status: { ...iso().status, observedGeneration: 1 } }, { ...iso(), spec: { ...iso().spec, version: 'unsupported' } }, { ...iso(), metadata: { ...iso().metadata, deletionTimestamp: 'now' } }, { ...iso(), status: { ...iso().status, completedBuild: undefined } }]
  assert.deepEqual(provisioningTargets(images), [{ ...iso().spec, isoRef: { name: 'debian-live', uid: 'iso-uid' } }])
  assert.deepEqual(provisioningTargets([]), [])
})

test('selected OS and ISO are saved with CAS; run uses returned generation', async () => {
  const item = server(); item.metadata.resourceVersion = '10'
  item.spec.operatingSystem.timezone = 'UTC'
  const calls = []
  await requestServerProvision(async (path, options) => {
    calls.push([path, options])
    if (!options) return { body: { ...item, metadata: { ...item.metadata, resourceVersion: '20' } } }
    if (options.method === 'PATCH') {
      assert.equal(options.headers['If-Match'], '"20"')
      const patch = JSON.parse(options.body)
      assert.deepEqual(patch, { operatingSystem: iso().spec, boot: { isoRef: selection().target.isoRef } })
      return { body: { ...item, metadata: { ...item.metadata, generation: 2, resourceVersion: '11' }, spec: { ...item.spec, operatingSystem: { ...item.spec.operatingSystem, ...patch.operatingSystem }, boot: patch.boot } } }
    }
    assert.equal(JSON.parse(options.body).spec.serverGeneration, 2)
  }, '/api/v1alpha1/servers', item, machine(), 'wwn:0x123', 'beelink', 'run', selection())
  assert.deepEqual(calls.map(([path, options]) => [path, options?.method || 'GET']), [['/api/v1alpha1/servers/beelink', 'GET'], ['/api/v1alpha1/servers/beelink', 'PATCH'], ['/api/v1alpha1/provisioning-runs', 'POST']])
  assert.equal(item.spec.operatingSystem.distribution, 'arch')
})

test('unchanged selected OS/ISO does not PATCH', async () => {
  const item = server(); item.spec.operatingSystem = iso().spec; item.spec.boot.isoRef = selection().target.isoRef
  await requestServerProvision(async (_, options) => { assert.equal(options.method, 'POST') }, '/api/v1alpha1/servers', item, machine(), 'wwn:0x123', 'beelink', 'run', selection())
})

test('invalid selection or confirmation cannot even save an OS', async () => {
  for (const [choice, confirmation] of [{ ...selection(), target: { ...selection().target, version: 'bookworm' } }, selection()].map((choice, i) => [choice, i ? 'wrong' : 'beelink'])) {
    await assert.rejects(requestServerProvision(() => assert.fail('must not write'), '/api/v1alpha1/servers', server(), machine(), 'wwn:0x123', confirmation, 'run', choice))
  }
})

test('OS save conflicts never create a run or retry', async () => {
  const item = server(); item.metadata.resourceVersion = '10'; let calls = 0
  await assert.rejects(requestServerProvision(async (_, options) => { if (!options) return { body: item }; calls++; assert.equal(options.method, 'PATCH'); throw new Error('Conflict') }, '/api/v1alpha1/servers', item, machine(), 'wwn:0x123', 'beelink', 'run', selection()), /Conflict/)
  assert.equal(calls, 1)
})

test('failed run creation explains that desired OS may already be saved', async () => {
  const item = server(); item.spec.operatingSystem = iso().spec; item.spec.boot.isoRef = selection().target.isoRef
  await assert.rejects(requestServerProvision(async () => { throw new Error('Conflict') }, '/api/v1alpha1/servers', item, machine(), 'wwn:0x123', 'beelink', 'run', selection()), /selected OS may already be saved/)
})

test('replaced Server after OS save never creates a run', async () => {
  const item = server(); item.metadata.resourceVersion = '10'
  await assert.rejects(requestServerProvision(async (_, options) => {
    if (!options) return { body: item }
    assert.equal(options.method, 'PATCH')
    return { body: { ...item, metadata: { ...item.metadata, uid: 'replacement' }, spec: { ...item.spec, operatingSystem: iso().spec, boot: { isoRef: selection().target.isoRef } } } }
  }, '/api/v1alpha1/servers', item, machine(), 'wwn:0x123', 'beelink', 'run', selection()), /Server changed/)
})

test('fresh-read desired-generation changes cannot save OS or create a run', async () => {
  const item = server(); item.metadata.resourceVersion = '10'
  await assert.rejects(requestServerProvision(async (_, options) => {
    assert.equal(options, undefined)
    return { body: { ...item, metadata: { ...item.metadata, generation: 2 } } }
  }, '/api/v1alpha1/servers', item, machine(), 'wwn:0x123', 'beelink', 'run', selection()), /desired configuration or binding changed/)
})
