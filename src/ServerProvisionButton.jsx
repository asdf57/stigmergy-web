import { useRef, useState } from 'react'
import { Alert, Box, Button, Code, Group, Modal, Select, Stack, Text, Tooltip } from '@mantine/core'
import { HardDrive } from 'lucide-react'
import { provisionBlockReason, provisionDisks, provisionPartitions, provisioningTargets, requestServerProvision } from './serverProvisioning.js'

export default function ServerProvisionButton({ item, resourcePath, apiFetch, onRequested, compact = false }) {
  const [opened, setOpened] = useState(false)
  const [reviewedServer, setReviewedServer] = useState(null)
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const [machine, setMachine] = useState(null)
  const [deviceID, setDeviceID] = useState(null)
  const [loadingDisks, setLoadingDisks] = useState(false)
  const [targets, setTargets] = useState([])
  const [partitionResources, setPartitionResources] = useState([])
  const [distribution, setDistribution] = useState(null)
  const [version, setVersion] = useState(null)
  const [isoUID, setIsoUID] = useState(null)
  const [needsReview, setNeedsReview] = useState(false)
  const inFlight = useRef(false)
  const loadID = useRef(0)
  const server = opened && reviewedServer ? reviewedServer : item
  const blocked = provisionBlockReason(server, { selectOperatingSystem: true })
  const matching = targets.filter(target => target.distribution === distribution && target.version === version)
  const target = matching.find(candidate => candidate.isoRef.uid === isoUID)
  const disks = machine ? provisionDisks(machine) : []
  const selected = disks.find(disk => disk.deviceID === deviceID)
  const partitions = machine ? provisionPartitions(server, machine, partitionResources, deviceID) : []
  const layoutReady = partitions.filter(partition => partition.spec.role === 'root').length === 1 && partitions.filter(partition => partition.spec.role === 'efi').length === 1
  const name = item.metadata.name
  const close = () => { if (!inFlight.current) { loadID.current++; setOpened(false) } }
  const open = async () => {
    const attempt = ++loadID.current
    setReviewedServer(null); setError(''); setNeedsReview(false); setMachine(null); setDeviceID(null); setTargets([]); setDistribution(null); setVersion(null); setIsoUID(null); setOpened(true); setLoadingDisks(true)
    try {
      setPartitionResources([])
      const { body: fresh } = await apiFetch(`${resourcePath}/${encodeURIComponent(name)}`)
      if (attempt !== loadID.current) return
      if (fresh.metadata.uid !== item.metadata.uid) throw new Error('The Server was replaced. Refresh the page before provisioning.')
      setReviewedServer(fresh)
      if (!fresh.status?.machineRef) throw new Error('Waiting for a discovered Machine binding.')
      const [result, images, layouts] = await Promise.all([
        apiFetch(`${resourcePath.replace(/\/servers$/, '/machines')}/${encodeURIComponent(fresh.status.machineRef.name)}`),
        apiFetch(resourcePath.replace(/\/servers$/, '/isos')),
        apiFetch(resourcePath.replace(/\/servers$/, '/disk-partitions')),
      ])
      if (attempt !== loadID.current) return
      if (result.body.metadata.uid !== fresh.status.machineRef.uid) throw new Error('The Machine binding changed. Refresh the Server.')
      const available = provisioningTargets(images.body.items || [])
      if (!available.length) throw new Error('No Ready amd64 UEFI ISO is available for a supported target (Arch rolling or Debian trixie).')
      setTargets(available)
      setPartitionResources(layouts.body.items || [])
      const preferred = available.find(candidate => candidate.isoRef.name === fresh.spec.boot?.isoRef?.name && candidate.distribution === fresh.spec.operatingSystem?.distribution && candidate.version === fresh.spec.operatingSystem?.version)
      if (preferred) { setDistribution(preferred.distribution); setVersion(preferred.version); setIsoUID(preferred.isoRef.uid) }
      setMachine(result.body)
    } catch (caught) { if (attempt === loadID.current) setError(caught.message) } finally { if (attempt === loadID.current) setLoadingDisks(false) }
  }
  const request = async () => {
    if (inFlight.current) return
    inFlight.current = true
    setSaving(true)
    setError('')
    try {
      const result = await requestServerProvision(apiFetch, resourcePath, server, machine, deviceID, undefined, { target, targets }, partitionResources)
      setOpened(false)
      onRequested(result)
    } catch (caught) {
      setNeedsReview(true)
      setError(caught.message)
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
        <Select label="Distribution" placeholder={loadingDisks ? 'Loading available ISOs…' : 'Select a distribution'} value={distribution} disabled={saving || loadingDisks} data={[...new Set(targets.map(candidate => candidate.distribution))]} onChange={value => { setDistribution(value); setVersion(null); setIsoUID(null) }} />
        <Select label="Version" placeholder="Select a version" value={version} disabled={saving || !distribution} data={[...new Set(targets.filter(candidate => candidate.distribution === distribution).map(candidate => candidate.version))]} onChange={value => { setVersion(value); const candidates = targets.filter(candidate => candidate.distribution === distribution && candidate.version === value); setIsoUID(candidates.length === 1 ? candidates[0].isoRef.uid : null) }} />
        <Select label="Live boot ISO" placeholder="Select a Ready ISO" value={isoUID} disabled={saving || !version} data={matching.map(candidate => ({ value: candidate.isoRef.uid, label: candidate.isoRef.name }))} onChange={value => { setIsoUID(value) }} />
        <Select label="System disk" placeholder={loadingDisks ? 'Loading discovered hardware…' : 'Select a disk'} value={deviceID} onChange={setDeviceID} disabled={saving || loadingDisks} data={disks.map((disk, index) => ({ value: disk.eligible ? disk.deviceID : `unavailable-${index}`, label: `${disk.model || disk.name} · ${(disk.size / 1024 ** 3).toFixed(1)} GiB · ${disk.serial || disk.wwn || 'No stable identity'} · ${disk.tran}`, disabled: !disk.eligible }))} />
        {selected && <Box><Text size="sm" fw={600}>Stable identity</Text><Code style={{ overflowWrap: 'anywhere' }}>{selected.deviceID}</Code></Box>}
        {selected && <Box><Text size="sm" fw={600}>Reviewed partition layout</Text>{partitions.map(partition => <Text size="sm" key={partition.metadata.uid}>#{partition.spec.number} · {partition.metadata.name} · {partition.spec.filesystem} · {partition.spec.mountPoint || 'swap'} · {partition.spec.capacity.storage || 'remaining space'}</Text>)}{!layoutReady && <Alert color="orange">Create this Server’s root and EFI DiskPartition resources using the resource editor before provisioning.</Alert>}</Box>}
        <Text size="sm">{target ? <>Install {target.distribution} {target.version} using ISO <Code>{target.isoRef.name}</Code>.</> : 'Select an OS and a Ready live ISO.'} Confirmation saves this OS/ISO as the Server’s desired configuration before requesting installation. Other packages/settings are preserved; review their compatibility. V1 supports one system disk; USB/media disks cannot be selected.</Text>
        <Text size="sm" c="dimmed">The shared provisioning operator picks up the request on its next run. It checks the disk and boot identity before installation. Other Servers are not requested.</Text>
        {blocked && <Alert color="orange">{blocked}{server.status?.operationRef && <> <a href={`#/resources/operations/${encodeURIComponent(server.status.operationRef.name)}`}>Inspect operation</a></>}</Alert>}
        {error && <Alert color="red">{error}</Alert>}
        <Group justify="flex-end"><Button variant="default" disabled={saving} onClick={close}>Cancel</Button><Button variant="default" disabled={saving || loadingDisks} onClick={open}>Refresh</Button><Button color="red" loading={saving} disabled={Boolean(blocked) || !target || !selected?.eligible || !layoutReady || loadingDisks || needsReview} onClick={request}>Erase disk and provision</Button></Group>
      </Stack>
    </Modal>
  </Box>
}
