import { useEffect, useState } from 'react'
import { Alert, Anchor, Badge, Code, Group, Paper, Stack, Text, Title } from '@mantine/core'
import { certificateHealth, executionLinks, resourceReferences, statusDetails, trustHealth } from './resourceInsights.js'
import { provisioningProgress } from './serverProvisioningProgress.js'

export function ResourceLink({ reference, resources, children }) {
  const resource = resources.find(candidate => candidate.kind === reference.kind)
  const label = children || `${reference.kind}/${reference.name}`
  if (!resource) return <Text size="sm">{label}</Text>
  return <Anchor size="sm" href={`#/resources/${resource.slug}/${encodeURIComponent(reference.name)}`} title={reference.uid ? `Referenced UID: ${reference.uid}` : undefined}>{label}</Anchor>
}

export default function ResourceInsights({ item, resources, apiFetch }) {
  const [links, setLinks] = useState([])
  const [linkError, setLinkError] = useState('')
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30000)
    return () => clearInterval(timer)
  }, [])
  useEffect(() => {
    const controller = new AbortController()
    setLinks([])
    setLinkError('')
    executionLinks(item, resources, apiFetch, controller.signal).then(value => {
      if (!controller.signal.aborted) setLinks(value)
    }).catch(error => {
      if (!controller.signal.aborted) setLinkError(error.message)
    })
    return () => controller.abort()
  }, [item, resources, apiFetch])

  const references = resourceReferences(item)
  const certificate = certificateHealth(item, now)
  const trust = trustHealth(item)
  const details = statusDetails(item)
  const conditions = item.status?.conditions || []
  const progress = item.kind === 'ProvisioningRun' ? provisioningProgress(item) : null
  const stale = item.status?.observedGeneration !== undefined && item.status.observedGeneration !== item.metadata.generation
  return <Stack gap="md" mb="lg">
    {(certificate || trust) && <Paper withBorder p="lg" radius="md">
      <Title order={2} size="h4" mb="sm">SSH security observations</Title>
      <Group mb="sm">
        {certificate && <Badge color={certificate.color}>{certificate.label}</Badge>}
        {trust && <Badge color={trust.color}>{trust.label}</Badge>}
      </Group>
      {certificate && <Stack gap={4}>
        <Text size="sm">Valid from: {item.status?.validAfter || 'Not reported'}</Text>
        <Text size="sm">Expires: {item.status?.validBefore || 'Not reported'}</Text>
        <Text size="sm">Scheduled renewal: {item.status?.renewAt || 'Not reported'}</Text>
        <Text size="xs" c="dimmed">Validity dates alone do not prove certificate readiness or successful renewal.</Text>
      </Stack>}
      {trust && <Stack gap={4}>
        <Text size="sm">Desired: <Code style={{ overflowWrap: 'anywhere' }}>{trust.desired || 'Not reported'}</Code></Text>
        <Text size="sm">{item.kind === 'ISO' ? 'Completed image' : 'Reported installed'}: <Code style={{ overflowWrap: 'anywhere' }}>{trust.observed || 'Not reported'}</Code></Text>
        <Text size="xs" c="dimmed">Digest comparison is reported convergence, not a new live verification.</Text>
      </Stack>}
    </Paper>}
    {(details.length > 0 || conditions.length > 0 || stale || links.length > 0 || linkError) && <Paper withBorder p="lg" radius="md">
      <Title order={2} size="h4" mb="sm">Controller and execution status</Title>
      {stale && <Alert color="yellow" mb="sm">Reported generation {item.status.observedGeneration}; desired generation {item.metadata.generation}. Observations may be stale.</Alert>}
      {['Failed', 'Blocked', 'Conflict'].includes(item.status?.phase) && <Alert color="red" mb="sm" title={item.status.phase}>
        {item.status.message || item.status.reason || 'Inspect the reported conditions and operator build for details.'}
      </Alert>}
      <Stack gap="xs">
        {progress && <>
          <Group gap="xs" aria-label="Provisioning checkpoints">{progress.steps.map(step => <Badge
            key={step.key} color={step.state === 'current' ? 'blue' : 'gray'}
            variant={step.state === 'current' ? 'filled' : 'light'}
          >{step.label}{step.state === 'current' ? ' · current' : ''}</Badge>)}</Group>
          <Text size="xs" c="dimmed">Current workflow checkpoint only, not an event history. Unhighlighted stages are not proof of completion.</Text>
        </>}
        {details.map(detail => <div key={detail.label}><Text size="xs" c="dimmed">{detail.label}</Text><Text size="sm" style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{detail.value}</Text></div>)}
        {conditions.map((condition, index) => <Paper withBorder p="sm" key={`${condition.type}-${index}`}>
          <Group gap="xs"><Text size="sm" fw={600}>{condition.type}</Text><Badge color={condition.status === 'True' ? 'blue' : 'yellow'}>{condition.status}</Badge></Group>
          <Text size="sm">{condition.reason}</Text>
          {condition.message && <Text size="sm" style={{ whiteSpace: 'pre-wrap' }}>{condition.message}</Text>}
          {condition.observedGeneration !== undefined && <Text size="xs" c="dimmed">Observed generation: {condition.observedGeneration}</Text>}
        </Paper>)}
        {links.map(link => <Anchor key={link.url} href={link.url} target="_blank" rel="noopener noreferrer">{link.label} ↗</Anchor>)}
        {linkError && <Alert color="yellow">Cannot resolve execution links: {linkError}</Alert>}
        {item.kind === 'ProvisioningRun' && <Text size="xs" c="dimmed">This API does not report a provider-qualified Concourse build reference for provisioning. No build link is guessed.</Text>}
      </Stack>
    </Paper>}
    {references.length > 0 && <Paper withBorder p="lg" radius="md">
      <Title order={2} size="h4" mb="sm">Related resources</Title>
      <Stack gap="xs">{references.map(reference => <Group key={`${reference.field}-${reference.kind}-${reference.name}`} justify="space-between">
        <Text size="xs" c="dimmed">{reference.field}</Text>
        <ResourceLink reference={reference} resources={resources} />
      </Group>)}</Stack>
    </Paper>}
  </Stack>
}
