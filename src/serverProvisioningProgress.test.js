import assert from 'node:assert/strict'
import { test } from 'node:test'
import { acceptProvisioningUpdate, provisioningProgress } from './serverProvisioningProgress.js'

const server = () => ({
  metadata: { uid: 'server-uid', resourceVersion: '42' },
  spec: { provisioning: { enabled: true, reprovision: 9 } },
  status: { provisioning: { requestedReprovision: 9, observedReprovision: 5,
    phase: 'Installing', message: 'Destructive stage entered', backendRunID: '123' } },
})

test('every checkpoint is shown with the reported current phase highlighted', () => {
  const progress = provisioningProgress(server())
  assert.equal(progress.steps.length, 7)
  assert.equal(progress.steps.find(step => step.state === 'current').key, 'Installing')
  assert.equal(progress.steps.at(-1).state, 'pending')
  assert.equal(progress.observed, 5)
  assert.equal(progress.buildID, '123')
})

test('new queued requests never display the previous attempt message or build', () => {
  const item = server()
  item.spec.provisioning.reprovision = 10
  item.status.provisioning.phase = 'Succeeded'
  item.status.provisioning.provisioned = true
  const progress = provisioningProgress(item)
  assert.equal(progress.phase, 'Queued')
  assert.equal(progress.request, 10)
  assert.equal(progress.message, '')
  assert.equal(progress.buildID, null)
  assert.equal(progress.steps[0].state, 'current')
})

test('blocked requests show failure and maintenance without inventing passed checkpoints', () => {
  const item = server()
  item.status.provisioning.phase = 'Blocked'
  item.status.provisioning.maintenance = true
  const progress = provisioningProgress(item)
  assert.equal(progress.phase, 'Blocked')
  assert.equal(progress.message, 'Destructive stage entered')
  assert.equal(progress.maintenance, true)
  assert.ok(progress.steps.every(step => step.state === 'unconfirmed'))
})

test('success remains tied to the observed counter', () => {
  const item = server()
  item.status.provisioning.phase = 'Succeeded'
  item.status.provisioning.observedReprovision = 9
  const progress = provisioningProgress(item)
  assert.equal(progress.observed, 9)
  assert.equal(progress.steps.at(-1).state, 'current')
})

test('poll responses cannot replace a new request with older status', () => {
  const item = server()
  assert.equal(acceptProvisioningUpdate(item, { metadata: { uid: 'server-uid', resourceVersion: '41' } }), false)
  assert.equal(acceptProvisioningUpdate(item, { metadata: { uid: 'server-uid', resourceVersion: '43' } }), true)
  assert.equal(acceptProvisioningUpdate(item, { metadata: { uid: 'replacement', resourceVersion: '99' } }), false)
})

test('resource version comparisons retain int64 precision', () => {
  const item = server()
  item.metadata.resourceVersion = '9007199254740993'
  assert.equal(acceptProvisioningUpdate(item, { metadata: { uid: 'server-uid', resourceVersion: '9007199254740992' } }), false)
})
