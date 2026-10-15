import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readActiveOperation } from './operationState.js'

const target = { kind: 'KubeCluster', metadata: { name: 'lab', uid: 'cluster-uid' }, status: { operationRef: { name: 'configure', uid: 'operation-uid' } } }
const operation = { kind: 'Operation', metadata: { name: 'configure', uid: 'operation-uid' }, spec: { targetRef: { kind: 'KubeCluster', name: 'lab', uid: 'cluster-uid' } }, status: { phase: 'Uncertain' } }

test('generic active operation observation uses only UID-bound GETs', async () => {
  const calls = []
  const observed = await readActiveOperation(async (path, options) => {
    assert.equal(options.method, undefined)
    calls.push(path)
    return { body: path.includes('/operations/') ? operation : target }
  }, '/api/v1alpha1/kube-clusters', target)
  assert.equal(observed.status.phase, 'Uncertain')
  assert.deepEqual(calls, ['/api/v1alpha1/kube-clusters/lab', '/api/v1alpha1/operations/configure'])
})

test('replacement target/operation and foreign ownership are rejected', async () => {
  for (const changed of [
    { ...operation, metadata: { ...operation.metadata, uid: 'replacement' } },
    { ...operation, spec: { targetRef: { ...operation.spec.targetRef, uid: 'another-target' } } },
  ]) {
    await assert.rejects(readActiveOperation(async path => ({ body: path.includes('/operations/') ? changed : target }), '/api/v1alpha1/kube-clusters', target), /identity/)
  }
  await assert.rejects(readActiveOperation(async () => ({ body: { ...target, metadata: { ...target.metadata, uid: 'replacement' } } }), '/api/v1alpha1/kube-clusters', target), /replaced/)
})

test('a released target does not fetch historical operations', async () => {
  let calls = 0
  assert.equal(await readActiveOperation(async () => { calls++; return { body: { ...target, status: {} } } }, '/api/v1alpha1/kube-clusters', target), null)
  assert.equal(calls, 1)
})

test('Operation detail polls its own fresh status without treating itself as a target', async () => {
  const completed = { ...operation, status: { phase: 'Succeeded', currentStep: 'Verified' } }
  assert.equal((await readActiveOperation(async () => ({ body: completed }), '/api/v1alpha1/operations', operation)).status.phase, 'Succeeded')
})
