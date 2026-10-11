import { useEffect, useState } from 'react'
import { Alert, Badge, Button, Code, Group, Loader, Paper, Stack, Table, Text, Title } from '@mantine/core'
import { loadServerStorage } from './resourceInsights.js'
import { ResourceLink } from './ResourceInsights.jsx'

const capacity = bytes => Number.isFinite(bytes) ? `${(bytes / 1024 ** 3).toFixed(2)} GiB` : 'Not reported'

export default function ServerStoragePanel({ item, resources, apiFetch }) {
  const [storage, setStorage] = useState(null)
  const [error, setError] = useState('')
  const [revision, setRevision] = useState(0)
  useEffect(() => {
    const controller = new AbortController()
    setStorage(null)
    setError('')
    loadServerStorage(item, resources, apiFetch, controller.signal).then(value => {
      if (!controller.signal.aborted) setStorage(value)
    }).catch(caught => {
      if (!controller.signal.aborted) setError(caught.message)
    })
    return () => controller.abort()
  }, [item.metadata.uid, item.status?.machineRef?.uid, item.status?.machineRef?.name, resources, apiFetch, revision])

  return <Paper withBorder p="lg" radius="md" mb="lg">
    <Group justify="space-between" mb="sm"><Title order={2} size="h4">Storage · desired and discovered</Title><Button size="compact-sm" variant="default" onClick={() => setRevision(value => value + 1)}>Refresh storage</Button></Group>
    <Text size="sm" c="dimmed" mb="md">Partition resources describe the next approved installation. They do not resize disks or authorize erasure.</Text>
    {error ? <Alert color="red">{error}</Alert> : !storage ? <Loader size="sm" /> : <Stack gap="md">
      <div><Title order={3} size="h5" mb="xs">Desired partitions</Title>
        {!storage.partitions.length ? <Text size="sm" c="dimmed">No DiskPartition resources for this Server.</Text> : <Table.ScrollContainer minWidth={650}><Table withTableBorder>
          <Table.Thead><Table.Tr>{['Resource', 'Disk selector', '#', 'Role', 'Capacity', 'Filesystem / mount'].map(label => <Table.Th key={label}>{label}</Table.Th>)}</Table.Tr></Table.Thead>
          <Table.Tbody>{storage.partitions.map(partition => <Table.Tr key={partition.metadata.uid}>
            <Table.Td><ResourceLink reference={{ kind: 'DiskPartition', ...partition.metadata }} resources={resources}>{partition.metadata.name}</ResourceLink></Table.Td>
            <Table.Td><Text size="xs">{Object.entries(partition.spec.diskSelector).map(([field, value]) => `${field}: ${value}`).join(' · ')}</Text></Table.Td>
            <Table.Td>{partition.spec.number}</Table.Td><Table.Td>{partition.spec.role}</Table.Td>
            <Table.Td>{partition.spec.capacity.useRemaining ? 'Remaining space' : partition.spec.capacity.storage}</Table.Td>
            <Table.Td>{partition.spec.filesystem} {partition.spec.mountPoint || ''}</Table.Td>
          </Table.Tr>)}</Table.Tbody>
        </Table></Table.ScrollContainer>}
      </div>
      <div><Title order={3} size="h5" mb="xs">Discovered storage</Title>
        {!storage.machine ? <Text size="sm" c="dimmed">No bound Machine.</Text> : <>
          <Group mb="sm"><ResourceLink reference={{ kind: 'Machine', ...storage.machine.metadata }} resources={resources} /><Text size="xs" c="dimmed">Last report: {storage.machine.status?.lastSeenTime || 'Unknown'}</Text></Group>
          {!(storage.machine.status?.inventory?.storage || []).length && <Text size="sm" c="dimmed">No disks reported.</Text>}
          <Stack gap="sm">{(storage.machine.status?.inventory?.storage || []).map((disk, index) => <Paper withBorder p="sm" key={`${disk.path}-${index}`}>
            <Group><Code>{disk.path || disk.name}</Code><Badge variant="light">{disk.tran || 'Unknown transport'}</Badge><Text size="sm">{capacity(disk.size)}</Text>{disk.readOnly && <Badge color="orange">Read-only</Badge>}{disk.removable && <Badge color="orange">Removable</Badge>}</Group>
            <Text size="xs" c="dimmed" mt="xs">Serial: {disk.serial || 'Not reported'} · WWN: {disk.wwn || 'Not reported'}</Text>
            {(disk.partitions || []).length > 0 && <Table.ScrollContainer minWidth={520}><Table mt="xs">
              <Table.Thead><Table.Tr>{['Partition', 'Size', 'Filesystem', 'Mounts'].map(label => <Table.Th key={label}>{label}</Table.Th>)}</Table.Tr></Table.Thead>
              <Table.Tbody>{disk.partitions.map(partition => <Table.Tr key={partition.number}><Table.Td>{partition.path}</Table.Td><Table.Td>{capacity(partition.size)}</Table.Td><Table.Td>{partition.filesystem || 'Unknown'}</Table.Td><Table.Td>{partition.mountPoints?.join(', ') || 'None reported'}</Table.Td></Table.Tr>)}</Table.Tbody>
            </Table></Table.ScrollContainer>}
          </Paper>)}</Stack>
        </>}
      </div>
    </Stack>}
  </Paper>
}
