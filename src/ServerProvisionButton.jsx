import { useRef, useState } from 'react'
import { Alert, Box, Button, Code, Group, Modal, Select, Stack, Text, TextInput, Tooltip } from '@mantine/core'
import { HardDrive } from 'lucide-react'
import { provisionBlockReason, provisionDisks, requestServerProvision } from './serverProvisioning.js'

export default function ServerProvisionButton({ item, resourcePath, apiFetch, onRequested, compact = false }) {
  const [opened, setOpened] = useState(false)
  const [confirmation, setConfirmation] = useState('')
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const [machine, setMachine] = useState(null)
  const [deviceID, setDeviceID] = useState(null)
  const [loadingDisks, setLoadingDisks] = useState(false)
  const inFlight = useRef(false)
  const blocked = provisionBlockReason(item)
  const disks = machine ? provisionDisks(machine) : []
  const selected = disks.find(disk => disk.deviceID === deviceID)
  const name = item.metadata.name
  const close = () => { if (!inFlight.current) setOpened(false) }
  const open = async () => {
    setConfirmation(''); setError(''); setMachine(null); setDeviceID(null); setOpened(true); setLoadingDisks(true)
    try {
      const result = await apiFetch(`${resourcePath.replace(/\/servers$/, '/machines')}/${encodeURIComponent(item.status.machineRef.name)}`)
      if (result.body.metadata.uid !== item.status.machineRef.uid) throw new Error('The Machine binding changed. Refresh the Server.')
      setMachine(result.body)
    } catch (caught) { setError(caught.message) } finally { setLoadingDisks(false) }
  }
  const request = async () => {
    if (inFlight.current) return
    inFlight.current = true
    setSaving(true)
    setError('')
    try {
      const result = await requestServerProvision(apiFetch, resourcePath, item, machine, deviceID, confirmation)
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
    <Tooltip label={blocked || 'Select a discovered system disk for installation'}>
      <span><Button color="orange" variant="light" size={compact ? 'compact-sm' : 'sm'} leftSection={<HardDrive size={15} />} disabled={Boolean(blocked) || saving} onClick={open}>Provision</Button></span>
    </Tooltip>
    <Modal opened={opened} onClose={close} closeOnEscape={!saving} closeOnClickOutside={!saving} withCloseButton={!saving} title={<Text fw={700}>Provision {name}?</Text>} centered>
      <Stack gap="md">
        <Alert color="red" title="This replaces the contents of the selected disk">All data on the selected disk will be permanently erased. This is not a normal reboot.</Alert>
        <Select label="System disk" placeholder={loadingDisks ? 'Loading discovered hardware…' : 'Select a disk'} value={deviceID} onChange={setDeviceID} disabled={saving || loadingDisks} data={disks.map((disk, index) => ({ value: disk.eligible ? disk.deviceID : `unavailable-${index}`, label: `${disk.model || disk.name} · ${(disk.size / 1024 ** 3).toFixed(1)} GiB · ${disk.serial || disk.wwn || 'No stable identity'} · ${disk.tran}`, disabled: !disk.eligible }))} />
        {selected && <Box><Text size="sm" fw={600}>Stable identity</Text><Code style={{ overflowWrap: 'anywhere' }}>{selected.deviceID}</Code></Box>}
        <Text size="sm">Install {item.spec.operatingSystem?.distribution} {item.spec.operatingSystem?.version} using ISO <Code>{item.spec.boot?.isoRef?.name}</Code>. V1 supports one system disk; USB/media disks cannot be selected.</Text>
        <Text size="sm" c="dimmed">The shared provisioning operator picks up the request on its next run. It checks the disk and boot identity before installation. Other Servers are not requested.</Text>
        {blocked && <Alert color="orange">{blocked}</Alert>}
        {error && <Alert color="red">{error}</Alert>}
        <TextInput label={`Type ${name} to confirm`} value={confirmation} disabled={saving} onChange={(event) => setConfirmation(event.currentTarget.value)} autoComplete="off" />
        <Group justify="flex-end"><Button variant="default" disabled={saving} onClick={close}>Cancel</Button><Button color="red" loading={saving} disabled={Boolean(blocked) || !selected?.eligible || confirmation !== name || loadingDisks} onClick={request}>Erase disk and provision</Button></Group>
      </Stack>
    </Modal>
  </Box>
}
