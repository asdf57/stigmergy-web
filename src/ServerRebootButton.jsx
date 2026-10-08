import { useEffect, useRef, useState } from 'react'
import { Alert, Box, Button, Code, Group, Modal, Select, Stack, Text, TextInput, Tooltip } from '@mantine/core'
import { RotateCw } from 'lucide-react'
import { executorContainsServer, rebootBlockReason, requestServerReboot } from './serverOperations.js'

export default function ServerRebootButton({ item, resourcePath, apiFetch, onRequested, compact = false }) {
  const [opened, setOpened] = useState(false)
  const [confirmation, setConfirmation] = useState('')
  const [executors, setExecutors] = useState([])
  const [executorUID, setExecutorUID] = useState(null)
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [command, setCommand] = useState(null)
  const [needsReview, setNeedsReview] = useState(false)
  const inFlight = useRef(false)
  const loadID = useRef(0)
  const base = resourcePath.replace(/\/servers$/, '')
  const blocked = rebootBlockReason(item)
  const running = command && !['Succeeded', 'Failed'].includes(command.status?.phase)
  useEffect(() => {
    if (!running) return undefined
    let active = true
    let fetching = false
    const poll = async () => {
      if (document.hidden || fetching) return
      fetching = true
      try {
        const { body } = await apiFetch(`${base}/commands/${encodeURIComponent(command.metadata.name)}`)
        if (active && body.metadata.uid === command.metadata.uid) setCommand(body)
        else if (active) setError('Command identity changed; inspect the Commands view.')
      } catch (caught) { if (active) setError(caught.message) } finally { fetching = false }
    }
    const timer = setInterval(poll, 5000)
    return () => { active = false; clearInterval(timer) }
  }, [running, command?.metadata.name, command?.metadata.uid, base, apiFetch])
  const close = () => { if (!inFlight.current) { loadID.current++; setOpened(false) } }
  const open = async () => {
    const attempt = ++loadID.current
    setOpened(true); setConfirmation(''); setError(''); setExecutors([]); setExecutorUID(null); setNeedsReview(false); setLoading(true)
    try {
      const [pipelines, groups] = await Promise.all([apiFetch(`${base}/commands-pipelines`), apiFetch(`${base}/inventory-capture-groups`)])
      if (attempt !== loadID.current) return
      const available = (pipelines.body.items || []).filter(executor => (groups.body.items || []).some(group => executorContainsServer(executor, group, item)))
      setExecutors(available)
      if (available.length === 1) setExecutorUID(available[0].metadata.uid)
      if (!available.length) setError('No Ready command executor captures this Server.')
    } catch (caught) { if (attempt === loadID.current) setError(caught.message) } finally { if (attempt === loadID.current) setLoading(false) }
  }
  const request = async () => {
    if (inFlight.current) return
    inFlight.current = true; setSaving(true); setError('')
    try {
      const result = await requestServerReboot(apiFetch, resourcePath, item, executors.find(executor => executor.metadata.uid === executorUID), confirmation)
      setCommand(result.body); setOpened(false); onRequested?.(result)
    } catch (caught) { setError(`${caught.message} No automatic retry: refresh and inspect Commands before trying again.`); setNeedsReview(true) }
    finally { inFlight.current = false; setSaving(false) }
  }
  return <Box onClick={event => event.stopPropagation()}>
    <Tooltip label={blocked || (running ? 'A reboot Command is already queued/running.' : 'Reboot through the existing Ansible command runner')}>
      <span><Button variant="light" size={compact ? 'compact-sm' : 'sm'} leftSection={<RotateCw size={15} />} disabled={Boolean(blocked) || saving || running} onClick={open}>Reboot</Button></span>
    </Tooltip>
    {command && <Text size="xs"><a href={`#/resources/commands/${encodeURIComponent(command.metadata.name)}`}>Reboot: {command.status?.phase || 'Pending'}</a></Text>}
    <Modal opened={opened} onClose={close} closeOnEscape={!saving} closeOnClickOutside={!saving} withCloseButton={!saving} title={`Reboot ${item.metadata.name}?`} centered>
      <Stack>
        <Alert color="orange">This interrupts workloads on this Server. It does not provision disks or change the OS.</Alert>
        <Select label="Command executor" placeholder={loading ? 'Loading…' : 'Select an executor'} value={executorUID} onChange={setExecutorUID} disabled={loading || saving} data={executors.map(executor => ({ value: executor.metadata.uid, label: executor.metadata.name }))} />
        <Text size="sm">Creates an ordinary single-Server Command. Ansible verifies a changed boot ID and fresh strict SSH; the homelabd badge separately shows reporting freshness.</Text>
        <Code>{item.metadata.uid}</Code>
        {error && <Alert color="red">{error}</Alert>}
        <TextInput label={`Type ${item.metadata.name} to confirm`} value={confirmation} onChange={event => setConfirmation(event.currentTarget.value)} disabled={saving} autoComplete="off" />
        <Group justify="flex-end"><Button variant="default" onClick={close} disabled={saving}>Cancel</Button><Button onClick={request} loading={saving} disabled={Boolean(blocked) || !executorUID || confirmation !== item.metadata.name || loading || needsReview}>Reboot Server</Button></Group>
      </Stack>
    </Modal>
  </Box>
}
