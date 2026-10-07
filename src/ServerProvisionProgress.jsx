import { useEffect, useRef, useState } from 'react'
import { Alert, Badge, Code, Group, Paper, Stack, Text, Title } from '@mantine/core'
import { provisioningProgress } from './serverProvisioningProgress.js'

export default function ServerProvisionProgress({ item, resourcePath, apiFetch, onUpdate }) {
  const [error, setError] = useState('')
  const update = useRef(onUpdate)
  update.current = onUpdate
  const name = item.metadata.name
  const uid = item.metadata.uid

  useEffect(() => {
    let active = true
    let timer
    const controller = new AbortController()
    const poll = async () => {
      try {
        if (!document.hidden) {
          const result = await apiFetch(`${resourcePath}/${encodeURIComponent(name)}`, {
            signal: controller.signal,
          })
          if (active) {
            if (result.body.metadata.uid !== uid) {
              setError('This Server was replaced. Refresh to view the new resource.')
              return
            }
            update.current(result)
            setError('')
          }
        }
      } catch (caught) {
        if (active) setError(`Updates paused: ${caught.message}. Showing the last received status.`)
      } finally {
        if (active) timer = setTimeout(poll, 5000)
      }
    }
    timer = setTimeout(poll, 5000)
    return () => {
      active = false
      clearTimeout(timer)
      controller.abort()
    }
  }, [apiFetch, name, resourcePath, uid])

  const progress = provisioningProgress(item)
  const color = progress.phase === 'Blocked' ? 'red' : progress.phase === 'Succeeded' ? 'green' : 'blue'
  return <Paper withBorder p="lg" radius="md" mb="lg" aria-label="Provisioning checkpoints">
    <Group justify="space-between" mb="sm">
      <Title order={2} size="h4">Provisioning · request {progress.request}</Title>
      <Badge color={color}>{progress.phase}</Badge>
    </Group>
    <Text size="sm" c="dimmed" mb="md">
      Last verified request: {progress.observed} · Updates every 5 seconds while this page is visible.
    </Text>
    {error && <Alert color="yellow" mb="md">{error}</Alert>}
    {progress.phase === 'Blocked' && <Alert color="red" mb="md" title="Provisioning blocked">
      {progress.message || 'Inspect the operator build before requesting another attempt.'}
      {progress.maintenance && <Text size="sm" mt="xs">Maintenance is retained; recovery must be inspected before another request.</Text>}
    </Alert>}
    <Stack gap="xs" role="list" aria-live="polite">
      {progress.steps.map(step => <Group key={step.key} align="flex-start" wrap="nowrap" role="listitem">
        <Badge color={step.state === 'current' ? color : 'gray'} variant={step.state === 'current' ? 'filled' : 'light'} w={105} style={{ flexShrink: 0 }}>
          {step.state === 'current' ? (progress.phase === 'Succeeded' ? 'Verified' : 'Current') : step.state === 'earlier' ? 'Earlier' : step.state === 'pending' ? 'Pending' : 'Unconfirmed'}
        </Badge>
        <div><Text size="sm" fw={step.state === 'current' ? 700 : 500}>{step.label}</Text><Text size="xs" c="dimmed">{step.description}</Text></div>
      </Group>)}
    </Stack>
    <Text size="xs" c="dimmed" mt="md">Workflow checkpoints, not a persisted event history. Earlier stages may have been skipped or completed between refreshes.</Text>
    {progress.phase !== 'Blocked' && progress.message && <Text size="sm" mt="sm">{progress.message}</Text>}
    <Group gap="md" mt="sm">
      {progress.buildID && <Text size="xs">Operator build: <Code>{progress.buildID}</Code></Text>}
      {progress.attemptID && <Text size="xs">Attempt: <Code>{progress.attemptID}</Code></Text>}
      {progress.startedAt && <Text size="xs">Started: {new Date(progress.startedAt).toLocaleString()}</Text>}
      {progress.completedAt && <Text size="xs">Finished: {new Date(progress.completedAt).toLocaleString()}</Text>}
    </Group>
  </Paper>
}
