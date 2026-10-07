import assert from 'node:assert/strict'
import { test } from 'node:test'
import { diskDeviceID, provisionBlockReason, provisionDisks, requestServerProvision } from './serverProvisioning.js'

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
