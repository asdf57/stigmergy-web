import { useRef, useState } from 'react'
import { Alert, Box, Button, Code, Group, Modal, Stack, Text, TextInput, Tooltip } from '@mantine/core'
import { HardDrive } from 'lucide-react'
import { provisionBlockReason, requestServerProvision } from './serverProvisioning.js'

export default function ServerProvisionButton({ item, resourcePath, etag, apiFetch, onRequested, compact = false }) {
  const [opened, setOpened] = useState(false)
  const [confirmation, setConfirmation] = useState('')
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const inFlight = useRef(false)
  const blocked = provisionBlockReason(item)
  const desired = item.spec?.provisioning || {}
  const name = item.metadata.name
  const close = () => { if (!inFlight.current) setOpened(false) }
  const request = async () => {
    if (inFlight.current) return
    inFlight.current = true
    setSaving(true)
    setError('')
    try {
      const result = await requestServerProvision(apiFetch, resourcePath, item, etag, confirmation)
      setOpened(false)
      onRequested(result)
    } catch (caught) {
      setError([409, 412].includes(caught.status)
        ? 'This Server changed since you opened it. Cancel, refresh, and review the disk and request again.'
        : caught.message)
    } finally {
      inFlight.current = false
      setSaving(false)
    }
  }
  return <Box onClick={(event) => event.stopPropagation()}>
    <Tooltip label={blocked || 'Request installation or replacement on the configured disk'}>
      <span><Button color="orange" variant="light" size={compact ? 'compact-sm' : 'sm'} leftSection={<HardDrive size={15} />} disabled={Boolean(blocked) || saving} onClick={() => { setConfirmation(''); setError(''); setOpened(true) }}>Provision</Button></span>
    </Tooltip>
    <Modal opened={opened} onClose={close} closeOnEscape={!saving} closeOnClickOutside={!saving} withCloseButton={!saving} title={<Text fw={700}>Provision {name}?</Text>} centered>
      <Stack gap="md">
        <Alert color="red" title="This replaces the contents of the target disk">All data on the configured disk will be permanently erased. This is not a normal reboot.</Alert>
        <Box><Text size="sm" fw={600}>Target disk</Text><Code style={{ overflowWrap: 'anywhere' }}>{desired.targetDisk}</Code></Box>
        <Text size="sm">Install {item.spec.operatingSystem?.distribution} {item.spec.operatingSystem?.version} using ISO <Code>{item.spec.boot?.isoRef?.name}</Code>. Request {(desired.reprovision ?? 0) + 1} will enable provisioning for this Server.</Text>
        <Text size="sm" c="dimmed">The shared provisioning operator picks up the request on its next run. It checks the disk and boot identity before installation. Other Servers are not requested.</Text>
        {blocked && <Alert color="orange">{blocked}</Alert>}
        {error && <Alert color="red">{error}</Alert>}
        <TextInput label={`Type ${name} to confirm`} value={confirmation} disabled={saving} onChange={(event) => setConfirmation(event.currentTarget.value)} autoComplete="off" />
        <Group justify="flex-end"><Button variant="default" disabled={saving} onClick={close}>Cancel</Button><Button color="red" loading={saving} disabled={Boolean(blocked) || confirmation !== name} onClick={request}>Erase disk and provision</Button></Group>
      </Stack>
    </Modal>
  </Box>
}
