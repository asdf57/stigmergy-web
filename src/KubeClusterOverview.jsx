import { useEffect, useState } from 'react'
import {
  Alert, Badge, Button, Code, CopyButton, Group, Loader, Paper,
  SimpleGrid, Stack, Table, Text, Title, Tooltip,
} from '@mantine/core'
import { ResourceLink } from './ResourceInsights.jsx'
import { agentPulse } from './serverOperations.js'
import { clusterOverview, loadClusterOverview } from './kubeClusterOverview.js'

const roleName = role => ({ 'control-plane': 'Control plane', worker: 'Worker' })[role] || 'Unknown role'
const time = value => Number.isFinite(Date.parse(value)) ? new Date(value).toLocaleString() : 'Not reported'

function Setting({ label, value }) {
  return <div>
    <Text size="xs" c="dimmed">{label}</Text>
    <Text size="sm" fw={600} style={{ overflowWrap: 'anywhere' }}>{value || 'Not configured'}</Text>
  </div>
}

function MemberRow({ member, verification, observation, resources, now }) {
  const { server, nodeName, role, bindingConflict } = member
  const pulse = agentPulse(server, now)
  const observed = verification?.observations.nodes.find(node => node.serverRef.uid === server.metadata.uid
    && node.nodeName === nodeName && node.role === role)
  const management = server.status?.networking?.management
  return <Table.Tr>
    <Table.Td>
      <ResourceLink reference={{ kind: 'Server', ...server.metadata }} resources={resources}>
        {server.metadata.name}
      </ResourceLink>
      <Text size="xs" c="dimmed">Node: {nodeName}</Text>
    </Table.Td>
    <Table.Td><Badge variant="light" color={role === 'control-plane' ? 'blue' : role === 'worker' ? 'teal' : 'orange'}>
      {roleName(role)}
    </Badge></Table.Td>
    <Table.Td>
      <Text size="sm">{management?.address?.address || 'Not resolved'}</Text>
      <Text size="xs" c="dimmed">{management?.interface?.name || 'No interface reported'}</Text>
    </Table.Td>
    <Table.Td><Tooltip label={pulse.description}><Badge color={pulse.color} variant="light">{pulse.label}</Badge></Tooltip></Table.Td>
    <Table.Td><Badge color={server.status?.hostSSH?.phase === 'Ready' ? 'green' : 'gray'} variant="light">
      {server.status?.hostSSH?.phase || 'Not reported'}
    </Badge></Table.Td>
    <Table.Td>
      {observation && <Badge color={observation.fresh && observation.membership.missingMembers.includes(nodeName) ? 'red' : 'gray'} variant="light" mb={4}>
        {!observation.fresh ? 'Membership observation is stale'
          : observation.membership.missingMembers.includes(nodeName) ? 'Missing from Kubernetes'
            : observation.membership.identityConflicts.includes(nodeName) ? 'Identity / labels differ'
              : observation.membership.notReadyMembers.includes(nodeName) ? 'Node not Ready'
                : 'Present and Ready at observation'}
      </Badge>}
      <Text size="sm" c={bindingConflict ? 'red' : 'dimmed'}>
        {bindingConflict ? 'Cluster UID conflict' : observed ? `Node ${observed.ready ? 'Ready' : 'Not Ready'} at verification` : 'Not verified in latest report'}
      </Text>
      {observed && <>
        <Text size="xs" c="dimmed">Node IP: {observed.internalIP} · Pods: {observed.podCIDR}</Text>
        <Text size="xs" c="dimmed">{observed.kubeletVersion} · containerd {observed.containerdVersion}</Text>
        <Text size="xs" c="dimmed">{observed.operatingSystem || 'OS not reported'}</Text>
        <Tooltip label={`Node UID: ${observed.nodeUID}`}><Text size="xs" c="dimmed">Kernel: {observed.kernelVersion || 'Not reported'}</Text></Tooltip>
      </>}
      {server.metadata.deletionTimestamp && <Badge color="orange" size="xs">Deleting</Badge>}
      {server.status?.provisioning?.activeRunRef && <ResourceLink
        reference={{ kind: 'ProvisioningRun', ...server.status.provisioning.activeRunRef }} resources={resources} />}
      {!server.status?.provisioning?.activeRunRef && server.status?.operation?.phase === 'Held'
        && <Text size="xs" c="dimmed">Managed operation in progress</Text>}
    </Table.Td>
  </Table.Tr>
}

/** Read-only cluster context; no Kubernetes credential or browser API bridge. */
export default function KubeClusterOverview({ item, resources, apiFetch }) {
  const [snapshot, setSnapshot] = useState(null)
  const [error, setError] = useState('')
  const [refresh, setRefresh] = useState(0)
  const [now, setNow] = useState(Date.now())
  const [loadedAt, setLoadedAt] = useState(null)

  useEffect(() => {
    const controller = new AbortController()
    let fetching = false
    const poll = async () => {
      if (controller.signal.aborted || fetching) return
      setNow(Date.now())
      fetching = true
      try {
        const value = await loadClusterOverview(item, resources, apiFetch, controller.signal)
        if (!controller.signal.aborted) {
          setSnapshot(value)
          setLoadedAt(Date.now())
          setError('')
        }
      } catch (caught) {
        if (!controller.signal.aborted) setError(caught.message)
      } finally { fetching = false }
    }
    poll()
    const timer = setInterval(() => { if (!document.hidden) poll() }, 10000)
    return () => { controller.abort(); clearInterval(timer) }
  }, [item.metadata.uid, item.metadata.name, resources, apiFetch, refresh])

  const sameLifetime = snapshot?.cluster.metadata.uid === item.metadata.uid
  const cluster = sameLifetime ? snapshot.cluster : item
  const overview = sameLifetime ? clusterOverview(cluster, snapshot.servers, snapshot.configurations, now) : null
  const verification = overview?.verification
  const settings = cluster.spec || {}
  const controlPlane = overview?.controlPlanes.length === 1 && !overview.controlPlanes[0].bindingConflict
    && !overview.controlPlanes[0].server.metadata.deletionTimestamp
    ? overview.controlPlanes[0].server : null
  const accessCommand = controlPlane
    ? `ssh ${controlPlane.metadata.name} 'sudo /usr/local/bin/kubectl --kubeconfig /etc/kubernetes/admin.conf get nodes -o wide'` : null

  return <Paper withBorder p="lg" radius="md" mb="lg">
    <Group justify="space-between" mb="md">
      <div><Title order={2} size="h4">Kubernetes cluster overview</Title>
        <Text size="xs" c="dimmed">API snapshot: {loadedAt ? new Date(loadedAt).toLocaleTimeString() : 'Loading'} · refreshes every 10 seconds</Text>
      </div>
      <Button size="compact-sm" variant="default" onClick={() => setRefresh(value => value + 1)}>Refresh cluster</Button>
    </Group>
    {error && <Alert color="orange" mb="md">{error}{sameLifetime && ' Showing the last successfully loaded snapshot.'}</Alert>}
    {!overview ? !error && <Loader size="sm" /> : <Stack gap="lg">
      <SimpleGrid cols={{ base: 1, sm: 3 }}>
        <Paper withBorder p="md" radius="md">
          <Text size="xs" c="dimmed">Desired members</Text><Text size="xl" fw={700}>{overview.members.length}</Text>
          <Text size="xs" c="dimmed">{overview.controlPlanes.length} control plane · {overview.workers.length} workers</Text>
        </Paper>
        <Paper withBorder p="md" radius="md">
          <Text size="xs" c="dimmed">Last successful verification</Text>
          <Text size="sm" fw={600} mt={6}>{time(verification?.observations.lastVerifiedAt)}</Text>
          <Badge mt="xs" variant="light" color={error ? 'gray' : overview.current ? 'green' : 'gray'}>
            {error ? 'Refresh unavailable' : overview.current ? 'Verified desired inputs' : verification ? 'Recorded observation' : 'No verified report'}
          </Badge>
        </Paper>
        <Paper withBorder p="md" radius="md">
          <Text size="xs" c="dimmed">Setup reconciliation</Text>
          <Text size="sm" fw={600} mt={6}>{verification?.configuration?.status.phase || 'See setup resources below'}</Text>
          <Text size="xs" c="dimmed">{verification?.configuration?.status.reason || 'No current reporting setup selected'}</Text>
        </Paper>
      </SimpleGrid>
      <SimpleGrid cols={{ base: 1, sm: 2, lg: 4 }}>
        <Setting label="API endpoint · direct kubeadm TLS" value={settings.controlPlaneEndpoint} />
        <Setting label="Pinned Kubernetes / containerd" value={`${settings.kubernetesVersion || '—'} / ${settings.containerdVersion || '—'}`} />
        <Setting label="Pod / service networks" value={`${settings.podCIDR || '—'} / ${settings.serviceCIDR || '—'}`} />
        <Setting label="Cluster network" value={`${settings.network?.provider || '—'} ${settings.network?.version || ''}`} />
        <Setting label="runc / CNI plugins" value={`${settings.runcVersion || 'Role default'} / ${settings.cniPluginsVersion || 'Role default'}`} />
        {verification && <Setting label="Observed Kubernetes / containerd" value={`${verification.observations.kubernetesVersion} / ${verification.observations.containerdVersion}`} />}
        {verification && <Setting label="Verified network checks" value={`Service DNS: ${verification.observations.checks?.serviceDNS === true ? 'Passed' : 'Not verified'} · Pod connectivity: ${verification.observations.checks?.podConnectivity === true ? 'Passed' : 'Not verified'}`} />}
      </SimpleGrid>
      {overview.issues.map(issue => <Alert key={issue} color="orange">{issue}</Alert>)}
      {overview.observation && <Alert color={overview.observation.fresh && overview.observation.membership.ready ? 'teal' : 'orange'}>
        Membership observed {time(overview.observation.observedAt)}{!overview.observation.fresh && ' (stale or inputs changed)'}.
        {['missingMembers', 'notReadyMembers', 'unexpectedNodes', 'identityConflicts'].map(field =>
          overview.observation.membership[field].length > 0 && <Text key={field} size="sm">
            {({ missingMembers: 'Missing', notReadyMembers: 'Not Ready', unexpectedNodes: 'Unexpected', identityConflicts: 'Identity / label conflicts' })[field]}: {overview.observation.membership[field].join(', ')}
          </Text>)}
        <Text size="xs">Membership is observed separately from the last successful workload verification.</Text>
      </Alert>}
      {verification && (!overview.settingsMatch || !overview.membershipMatches) && <Alert color="orange">
        Desired settings or membership differ from the last verified report. That report does not verify the new desired state.
      </Alert>}
      <div>
        <Title order={3} size="h5" mb="xs">Server membership</Title>
        <Text size="xs" c="dimmed" mb="sm">Labels select desired members. Agent freshness and SSH status are not live Kubernetes Node readiness.</Text>
        {!overview.members.length ? <Text size="sm" c="dimmed">No Servers select this cluster.</Text> : <Table.ScrollContainer minWidth={780}>
          <Table withTableBorder highlightOnHover>
            <Table.Thead><Table.Tr>{['Server / node', 'Desired role', 'Management address', 'homelabd', 'Managed SSH', 'Verified Node snapshot'].map(label =>
              <Table.Th key={label}>{label}</Table.Th>)}</Table.Tr></Table.Thead>
            <Table.Tbody>{overview.members.map(member => <MemberRow key={member.server.metadata.uid}
              member={member} verification={verification} observation={overview.observation} resources={resources} now={now} />)}</Table.Tbody>
          </Table>
        </Table.ScrollContainer>}
        {overview.unmatchedNodes.length > 0 && <Alert color="orange" mt="sm">
          Previously verified members no longer matching desired membership: {overview.unmatchedNodes.map(node => node.nodeName).join(', ')}.
          This is historical membership, not proof those Nodes still exist.
        </Alert>}
      </div>
      <div>
        <Title order={3} size="h5" mb="xs">Configuration resources</Title>
        {!overview.setups.length ? <Text size="sm" c="dimmed">No Configuration targets this cluster.</Text> : <Stack gap="xs">
          {overview.setups.map(configuration => <Group key={configuration.metadata.uid} justify="space-between">
            <ResourceLink reference={{ kind: 'Configuration', ...configuration.metadata }} resources={resources} />
            <Group gap="xs"><Badge variant="light" color={configuration.status?.phase === 'Failed' ? 'red' : 'blue'}>{configuration.status?.phase || 'Not reported'}</Badge>
              <Text size="xs" c="dimmed">{configuration.status?.reason || ''}</Text>
            </Group>
          </Group>)}
        </Stack>}
        {verification && <>
          <Text size="xs" c="dimmed" mt="sm">Observed cluster identity: {verification.observations.clusterNamespaceUID}</Text>
          <Text size="xs" c="dimmed">Report from {verification.observations.configurationRef.name} · playbook {verification.observations.playbookRevision || 'Not reported'}</Text>
          <Text size="xs" c="dimmed">Node readiness is a timestamped observation, not a live browser connection to Kubernetes.</Text>
        </>}
      </div>
      {accessCommand && <div>
        <Group justify="space-between" mb="xs"><Title order={3} size="h5">Inspect from homelabc</Title>
          <CopyButton value={accessCommand}>{({ copied, copy }) => <Button size="compact-sm" variant="default" onClick={copy}>{copied ? 'Copied' : 'Copy command'}</Button>}</CopyButton>
        </Group>
        <Code block>{accessCommand}</Code>
        <Text size="xs" c="dimmed" mt="xs">Use an SSH inventory containing this control plane. The browser does not fetch kubeconfigs or contact the Kubernetes API.</Text>
      </div>}
    </Stack>}
  </Paper>
}
