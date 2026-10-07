import assert from 'node:assert/strict'
import { test } from 'node:test'
import { acceptProvisioningUpdate, provisioningProgress } from './serverProvisioningProgress.js'

test('checkpoints belong to the run, not Server counters', () => {
  const progress = provisioningProgress({ metadata: { name: 'run' }, status: { phase: 'Installing', backendRunID: '123', message: 'Installing' } })
  assert.equal(progress.request, 'run'); assert.equal(progress.buildID, '123')
  assert.equal(progress.steps.find(step => step.state === 'current').key, 'Installing')
})
test('pending and missing runs cannot show previous successful progress', () => {
  assert.equal(provisioningProgress({ status: { phase: 'Pending' } }).phase, 'Queued')
  assert.equal(provisioningProgress(null).phase, 'Not requested')
  assert.equal(provisioningProgress(null).buildID, undefined)
})
test('blocked runs never invent completed checkpoints', () => {
  const result = provisioningProgress({ status: { phase: 'Blocked', maintenance: true, message: 'Inspect disk' } })
  assert.ok(result.steps.every(step => step.state === 'unconfirmed')); assert.equal(result.message, 'Inspect disk')
})
test('stale and replaced run poll responses are rejected with int64 precision', () => {
  const current = { metadata: { uid: 'run', resourceVersion: '9007199254740993' } }
  assert.equal(acceptProvisioningUpdate(current, { metadata: { uid: 'run', resourceVersion: '9007199254740992' } }), false)
  assert.equal(acceptProvisioningUpdate(current, { metadata: { uid: 'run', resourceVersion: '9007199254740994' } }), true)
  assert.equal(acceptProvisioningUpdate(current, { metadata: { uid: 'replacement', resourceVersion: '9007199254740994' } }), false)
})
