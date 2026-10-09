import assert from 'node:assert/strict'
import test from 'node:test'
import { deleteBlockedProvision } from './deleteBlockedProvision.js'

const server = { metadata: { name: 'host' }, status: { provisioning: { activeRunRef: { name: 'run', uid: 'uid' } } } }
const run = { metadata: { name: 'run', uid: 'uid', resourceVersion: '7' }, status: { phase: 'Blocked' } }

test('blocked deletion uses latest If-Match and refreshes Server; no new run', async () => {
  const calls = []
  const fetch = async (path, options) => {
    calls.push([path, options])
    return { body: path.endsWith('/host') ? server : run }
  }
  await deleteBlockedProvision(fetch, '/api/v1alpha1/servers', server, run)
  assert.equal(calls.length, 3)
  assert.deepEqual(calls[1][1], { method: 'DELETE', headers: { 'If-Match': '"7"' } })
  assert.equal(calls[2][0], '/api/v1alpha1/servers/host')
})

test('active or replaced runs cannot be deleted', async () => {
  for (const changed of [{ ...run, status: { phase: 'Installing' } }, { ...run, metadata: { ...run.metadata, uid: 'other' } }]) {
    await assert.rejects(deleteBlockedProvision(async () => { throw new Error('must not call') }, '/servers', server, changed), /Refresh/)
  }
  let calls = 0
  await assert.rejects(deleteBlockedProvision(async () => { calls++; return { body: { ...run, status: { phase: 'Installing' } } } }, '/servers', server, run), /changed/)
  assert.equal(calls, 1)
})
