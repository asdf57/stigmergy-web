import { Group, Select, TextInput } from '@mantine/core'
import { serverNames } from './resourceInsights.js'

export default function ResourceListFilters({ items, phaseOf, filters, onChange }) {
  const phases = [...new Set(items.map(phaseOf))].sort()
  const servers = [...new Set(items.flatMap(serverNames))].sort()
  return <Group mb="md" align="end">
    <Select label="Phase" placeholder="All phases" clearable data={phases} value={filters.phase || null} onChange={phase => onChange({ ...filters, phase: phase || '' })} />
    {servers.length > 0 && <Select label="Server" placeholder="All Servers" clearable searchable data={servers} value={filters.server || null} onChange={server => onChange({ ...filters, server: server || '' })} />}
    <TextInput label="Label" placeholder="e.g. cluster=lab" value={filters.label} onChange={event => onChange({ ...filters, label: event.currentTarget.value })} />
  </Group>
}
