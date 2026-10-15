import { useEffect, useState } from 'react'
import { Alert, Anchor, Badge, Group, Stack, Text } from '@mantine/core'
import { readActiveOperation } from './operationState.js'

/** Observe coordination on any resource, without issuing mutations or clearing locks. */
export default function ActiveOperation({ item, resourcePath, apiFetch }) {
  const [operation, setOperation] = useState(null)
  const [error, setError] = useState('')

  useEffect(() => {
    const controller = new AbortController()
    let fetching = false
    const poll = async () => {
      if (fetching || document.hidden) return
      fetching = true
      try {
        const current = await readActiveOperation(apiFetch, resourcePath, item, controller.signal)
        if (!controller.signal.aborted) { setOperation(current); setError('') }
      } catch (caught) {
        if (!controller.signal.aborted) setError(caught.message)
      } finally { fetching = false }
    }
    setOperation(null)
    setError('')
    poll()
    const timer = setInterval(poll, 5000)
    return () => { controller.abort(); clearInterval(timer) }
  }, [item.kind, item.metadata.name, item.metadata.uid, resourcePath, apiFetch])

  if (error) return <Alert color="orange" mb="md" title="Operation observation unavailable">{error}</Alert>
  if (!operation) return null
  const status = operation.status || {}
  return <Alert mb="md" color={status.phase === 'Uncertain' ? 'red' : status.phase === 'Succeeded' ? 'green' : 'blue'} title={item.kind === 'Operation' ? 'Operation progress' : 'Active operation'}>
    <Stack gap="xs">
      <Group><Anchor href={`#/resources/operations/${encodeURIComponent(operation.metadata.name)}`}>{operation.metadata.name}</Anchor><Badge>{status.phase}</Badge></Group>
      <Text size="sm">{operation.spec.operator} · {operation.spec.action}</Text>
      <Text size="sm">Target: {operation.spec.targetRef.kind}/{operation.spec.targetRef.name}</Text>
      {operation.spec.requestedBy && <Text size="sm">Requested by {operation.spec.requestedBy.kind}/{operation.spec.requestedBy.name}</Text>}
      <Text size="sm">{status.currentStep || 'No step reported'}</Text>
      {status.message && <Text size="sm">{status.message}</Text>}
      <Text size="xs">Started {status.startedAt || 'not reported'} · updated {status.updatedAt || 'not reported'}</Text>
      {status.phase === 'Uncertain' && <Text size="sm">Inspect remote work before explicitly resolving this Operation. Age does not release ownership.</Text>}
    </Stack>
  </Alert>
}
