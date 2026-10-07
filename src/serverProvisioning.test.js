import assert from 'node:assert/strict'
import { test } from 'node:test'
import { provisionBlockReason, requestServerProvision, serverProvisioningPhase } from './serverProvisioning.js'

const server = () => ({
  metadata: { name: 'beelink', uid: 'server-uid', resourceVersion: '42' },
  spec: { provisioning: { enabled: true, reprovision: 5, targetDisk: '/dev/disk/by-id/approved-ssd' },
    operatingSystem: { architecture: 'amd64', bootMode: 'uefi', distribution: 'arch', version: 'rolling' },
    boot: { isoRef: { name: 'arch-live' } }, sshCertificateAuthorityRef: { name: 'user-ca' } },
  status: { provisioning: { phase: 'Succeeded', provisioned: true, requestedReprovision: 5, observedReprovision: 5 } },
})

test('explicit confirmation queues exactly one conditional spec increment without changing the disk', async () => {
  const item = server()
  const calls = []
  await requestServerProvision(async (...args) => { calls.push(args); return { body: item } }, '/api/v1alpha1/servers', item, '"42"', 'beelink')
  assert.equal(calls.length, 1)
  assert.equal(calls[0][0], '/api/v1alpha1/servers/beelink')
  assert.equal(calls[0][1].method, 'PATCH')
  assert.equal(calls[0][1].headers['If-Match'], '"42"')
  assert.equal(calls[0][1].headers['Content-Type'], 'application/merge-patch+json')
  assert.deepEqual(JSON.parse(calls[0][1].body), { provisioning: { enabled: true, reprovision: 6 } })
  assert.equal(item.spec.provisioning.reprovision, 5)
})

test('first intentional installation enables provisioning and uses resourceVersion fallback', async () => {
  const item = server()
  item.spec.provisioning = { enabled: false, targetDisk: '/dev/disk/by-id/approved-ssd' }
  item.status = {}
  await requestServerProvision(async (path, options) => {
    assert.equal(options.headers['If-Match'], '"42"')
    assert.deepEqual(JSON.parse(options.body), { provisioning: { enabled: true, reprovision: 1 } })
  }, '/api/v1alpha1/servers', item, '', 'beelink')
})

test('missing confirmation never sends a request', async () => {
  await assert.rejects(requestServerProvision(() => assert.fail('must not send'), '/api/v1alpha1/servers', server(), '', 'wrong'), /exact Server name/)
})

test('unsafe or incomplete states cannot request provisioning', async () => {
  const mutations = [
    item => { item.status.provisioning.maintenance = true },
    item => { item.status.provisioning.phase = 'Installing' },
    item => { item.metadata.deletionTimestamp = 'now' },
    item => { item.spec.reconciliation = { paused: true } },
    item => { item.spec.provisioning.targetDisk = '/dev/sda' },
    item => { delete item.spec.boot },
    item => { delete item.spec.sshCertificateAuthorityRef },
    item => { item.spec.operatingSystem.bootMode = 'bios' },
    item => { item.spec.provisioning.reprovision = Number.MAX_SAFE_INTEGER },
    item => { item.spec.provisioning.reprovision = -1 },
    item => { delete item.metadata.resourceVersion },
    item => { item.spec.provisioning.reprovision = 6 },
  ]
  for (const mutate of mutations) {
    const item = server(); mutate(item)
    assert.ok(provisionBlockReason(item))
    await assert.rejects(requestServerProvision(() => assert.fail('must not send'), '/api/v1alpha1/servers', item, '', 'beelink'))
  }
})

test('conflicts are surfaced and never automatically retried', async () => {
  let calls = 0
  const conflict = Object.assign(new Error('Conflict'), { status: 409 })
  await assert.rejects(requestServerProvision(async () => { calls++; throw conflict }, '/api/v1alpha1/servers', server(), '', 'beelink'), error => error === conflict)
  assert.equal(calls, 1)
})

test('status shows queued work instead of the previous successful installation', () => {
  const item = server()
  assert.equal(serverProvisioningPhase(item), 'Succeeded')
  item.spec.provisioning.reprovision = 6
  assert.equal(serverProvisioningPhase(item), 'Queued')
  item.status.provisioning = { phase: 'Installing', maintenance: true, requestedReprovision: 6 }
  assert.equal(serverProvisioningPhase(item), 'Installing')
  item.status.provisioning.phase = 'Blocked'
  assert.equal(serverProvisioningPhase(item), 'Blocked')
})
