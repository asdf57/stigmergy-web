import { Badge, Group, Table, Text, Title } from '@mantine/core'
import { ResourceLink } from './ResourceInsights.jsx'
import { clusterComponents, componentStatus } from './clusterComponents.js'

const verificationTime = value => Number.isFinite(Date.parse(value)) ? new Date(value).toLocaleString() : 'Not verified'

/** Reuse the overview's API snapshot; this panel never fetches or mutates workloads. */
export default function ClusterComponents({ cluster, configurations, resources, now, refreshUnavailable }) {
  const components = clusterComponents(cluster, configurations)
  return <div>
    <Group gap="xs" mb="xs">
      <Title order={3} size="h5">Cluster components</Title>
      <Badge variant="light" color="gray">{components.length}</Badge>
      {refreshUnavailable && <Badge variant="light" color="orange">Last loaded snapshot</Badge>}
    </Group>
    <Text size="xs" c="dimmed" mb="sm">Declared Configurations that use this cluster or follow its setup. Status is their reported reconciliation, not a live Kubernetes workload inventory.</Text>
    {!components.length ? <Text size="sm" c="dimmed">No component Configurations are declared for this cluster.</Text> : <Table.ScrollContainer minWidth={640}>
      <Table withTableBorder highlightOnHover>
        <Table.Thead><Table.Tr>{['Component', 'Reconciliation', 'Depends on', 'Last verified'].map(label => <Table.Th key={label}>{label}</Table.Th>)}</Table.Tr></Table.Thead>
        <Table.Tbody>{components.map(configuration => {
          const status = componentStatus(configuration, cluster, configurations, now)
          return <Table.Tr key={configuration.metadata.uid}>
            <Table.Td><ResourceLink reference={{ kind: 'Configuration', ...configuration.metadata }} resources={resources} /></Table.Td>
            <Table.Td>
              <Badge variant="light" color={refreshUnavailable && status.color === 'green' ? 'gray' : status.color}>{status.label}</Badge>
              {configuration.status?.reason && <Text size="xs" c="dimmed" mt={4}>{configuration.status.reason}</Text>}
              {configuration.status?.message && <Text size="xs" c="dimmed">{configuration.status.message}</Text>}
            </Table.Td>
            <Table.Td><Group gap="xs">{configuration.spec?.dependsOn?.length ? configuration.spec.dependsOn.map(reference =>
              <ResourceLink key={reference.name} reference={{ kind: 'Configuration', ...reference }} resources={resources} />)
              : <Text size="xs" c="dimmed">None declared</Text>}</Group></Table.Td>
            <Table.Td><Text size="xs">{verificationTime(configuration.status?.lastVerifiedAt)}</Text></Table.Td>
          </Table.Tr>
        })}</Table.Tbody>
      </Table>
    </Table.ScrollContainer>}
  </div>
}
