import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from 'react'
import Form from '@rjsf/mantine'
import validator from '@rjsf/validator-ajv8'
import {
  ActionIcon, Alert, AppShell, Avatar, Badge, Box, Burger, Button, Card,
  Code, Divider, Group, JsonInput, Loader, Modal, NavLink, Paper, ScrollArea,
  SegmentedControl, Select, SimpleGrid, Skeleton, Stack, Table, Tabs, Text, TextInput,
  ThemeIcon, Title, Tooltip, PasswordInput, useComputedColorScheme, useMantineColorScheme,
} from '@mantine/core'
import { notifications } from '@mantine/notifications'
import ServerProvisionButton from './ServerProvisionButton.jsx'
import ServerRebootButton from './ServerRebootButton.jsx'
import ServerAgentPulse from './ServerAgentPulse.jsx'
import ServerProvisionProgress from './ServerProvisionProgress.jsx'
import { acceptProvisioningUpdate } from './serverProvisioningProgress.js'
import { serverProvisioningPhase } from './serverProvisioning.js'
import { useDisclosure, useMediaQuery } from '@mantine/hooks'
import {
  Activity, AlertTriangle, ArrowLeft, Boxes, Check, ChevronRight, CircleDot, Code2,
  Copy, Database, ExternalLink, FileJson, HardDrive, Home,
  Menu, Moon, Package, Plus, RefreshCw, Search, Server, Settings2, Shield, Sun,
  Trash2, Users, X,
} from 'lucide-react'

const MonacoShellScriptWidget = lazy(() => import('./ShellScriptWidget.jsx'))
function ShellScriptWidget(props) { return <Suspense fallback={<Skeleton height={460} radius="sm" />}><MonacoShellScriptWidget {...props} /></Suspense> }

const EMPTY_SPEC = { paths: {}, components: { schemas: {} } }
const FILE_REGISTRY_URL = import.meta.env.VITE_FILE_REGISTRY_URL || 'https://copyparty.ryuugu.dev/'
const groups = [
  ['Infrastructure', ['Machine', 'MachineReport', 'Server', 'Router', 'DNSRecord'], Server],
  ['Automation', ['ISO', 'Pipeline', 'PipelineProvider', 'CommandsPipeline', 'Command'], Activity],
  ['Inventory', ['InventoryCaptureGroup', 'InventoryPublication', 'GitRepository'], Database],
  ['Security', ['SecretStore', 'Secret', 'SSHKeyPair', 'SSHCertificateAuthority', 'UsernamePasswordCredential'], Shield],
]

const humanize = (value = '') => value.replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/[-_]+/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase())
const pluralLabel = (kind) => kind.endsWith('y') ? `${humanize(kind.slice(0, -1))}ies` : kind.endsWith('s') ? `${humanize(kind)}es` : `${humanize(kind)}s`
const navigate = (path = '') => { window.location.hash = path ? `#/${path}` : '#/' }

function useHashRoute() {
  const read = () => window.location.hash.replace(/^#\/?/, '').split('/').filter(Boolean)
  const [route, setRoute] = useState(read)
  useEffect(() => { const listener = () => setRoute(read()); window.addEventListener('hashchange', listener); return () => window.removeEventListener('hashchange', listener) }, [])
  return route
}

let sessionApiToken = ''
function authorizedFetch(path, options = {}) {
  const url = new URL(path, window.location.origin)
  const headers = new Headers(options.headers)
  if (sessionApiToken && url.origin === window.location.origin && url.pathname.startsWith('/api/') && !headers.has('Authorization')) headers.set('Authorization', `Bearer ${sessionApiToken}`)
  return fetch(path, { ...options, headers })
}

async function apiFetch(path, options = {}) {
  const response = await authorizedFetch(path, options)
  const type = response.headers.get('content-type') || ''
  const body = type.includes('json') ? await response.json() : await response.text()
  if (!response.ok) {
    const error = new Error(body?.error?.message || body?.message || body || `${response.status} ${response.statusText}`)
    error.status = response.status
    throw error
  }
  return { body, response }
}

function discoverResources(spec) {
  return Object.entries(spec.paths || {}).flatMap(([path, pathItem]) => {
    if (!path.startsWith('/api/') || path.includes('{') || !pathItem.post || !pathItem.get) return []
    const ref = pathItem.post.requestBody?.content?.['application/json']?.schema?.$ref
    const createSchema = ref?.split('/').pop()
    const schema = spec.components?.schemas?.[createSchema]
    const kind = schema?.properties?.kind?.const || pathItem.post.operationId?.replace(/^create/, '')
    if (!kind) return []
    return [{ kind, label: pluralLabel(kind), path, slug: path.split('/').pop(), createSchema, specSchema: schema?.properties?.spec?.$ref?.split('/').pop(), apiVersion: schema?.properties?.apiVersion?.const || 'homelab.io/v1alpha1' }]
  }).sort((a, b) => a.label.localeCompare(b.label))
}

function dereference(schema, components, seen = new Set()) {
  if (!schema || typeof schema !== 'object') return schema
  if (schema.$ref) {
    const name = schema.$ref.split('/').pop()
    if (seen.has(name)) return { type: 'object', title: humanize(name) }
    return dereference(components[name], components, new Set([...seen, name]))
  }
  if (Array.isArray(schema)) return schema.map((entry) => dereference(entry, components, seen))
  return Object.fromEntries(Object.entries(schema).filter(([key]) => key !== 'readOnly').map(([key, value]) => [key, dereference(value, components, seen)]))
}

const referenceKinds = {
  authorizedKeyRefs: 'SSHKeyPair',
  commandsRepositoryRef: 'GitRepository',
  credentialRef: 'UsernamePasswordCredential',
  inventoryCaptureGroupRef: 'InventoryCaptureGroup',
  pipelineProviderRef: 'PipelineProvider',
  providerRef: 'PipelineProvider',
  secretStoreRef: 'SecretStore',
  sshKeyPairRef: 'SSHKeyPair',
  signingKeyRef: 'SSHKeyPair',
  trustedKeyRefs: 'SSHKeyPair',
  sshCertificateAuthorityRef: 'SSHCertificateAuthority',
  repositoryRef: 'GitRepository',
  isoRef: 'ISO',
}

const constrainedReferenceKinds = {
  backingStoreRef: ['Router'],
  destinationRef: ['GitRepository'],
}

function choiceSchema(schema, values, label = (value) => value) {
  const choices = [...new Set(values.filter(Boolean))]
  if (!choices.length) return schema
  return { ...schema, oneOf: choices.map((value) => ({ const: value, title: label(value) })) }
}

function referenceKind(field, data, resources) {
  if (referenceKinds[field]) return referenceKinds[field]
  if (data?.kind && resources.some((resource) => resource.kind === data.kind)) return data.kind
  if (data?.type && resources.some((resource) => resource.kind === data.type)) return data.type
  if (constrainedReferenceKinds[field]?.length === 1) return constrainedReferenceKinds[field][0]
  return ''
}

function addResourceChoices(schema, data, resources, catalog, field = '') {
  if (!schema || typeof schema !== 'object') return schema
  const next = { ...schema }

  if (next.type === 'object' || next.properties) {
    const properties = next.properties || {}
    const hasResourceName = properties.name && (field.endsWith('Ref') || field.endsWith('Refs') || referenceKinds[field] || properties.kind || properties.type)
    const allowedKinds = constrainedReferenceKinds[field] || resources.map((resource) => resource.kind)
    const selectedKind = referenceKind(field, data, resources)
    next.properties = Object.fromEntries(Object.entries(properties).map(([key, child]) => {
      let enhanced = addResourceChoices(child, data?.[key], resources, catalog, key)
      if (key === 'kind' && (hasResourceName || field === 'matchKinds')) {
        enhanced = choiceSchema(enhanced, [...allowedKinds, data?.kind], (kind) => humanize(kind))
      }
      if (key === 'apiVersion' && (hasResourceName || field === 'matchKinds')) {
        const kind = data?.kind
        const versions = resources.filter((resource) => !kind || resource.kind === kind).map((resource) => resource.apiVersion)
        enhanced = choiceSchema(enhanced, [...versions, data?.apiVersion])
      }
      if (key === 'name' && hasResourceName && selectedKind) {
        const items = catalog[selectedKind] || []
        const names = items.map((item) => item.metadata?.name)
        enhanced = choiceSchema(enhanced, [...names, data?.name], (name) => {
          const item = items.find((candidate) => candidate.metadata?.name === name)
          return item ? `${name} — ${resourceStatus(item)}` : name
        })
      }
      return [key, enhanced]
    }))
  }

  if (next.items) {
    next.items = addResourceChoices(next.items, Array.isArray(data) ? data[0] : undefined, resources, catalog, field)
    if (referenceKinds[field] && next.items.type === 'string') {
      const kind = referenceKinds[field]
      const names = (catalog[kind] || []).map((item) => item.metadata?.name)
      next.items = choiceSchema(next.items, [...names, ...(Array.isArray(data) ? data : [])])
    }
  } else if (next.type === 'string' && referenceKinds[field]) {
    const kind = referenceKinds[field]
    const names = (catalog[kind] || []).map((item) => item.metadata?.name)
    return choiceSchema(next, [...names, data])
  }
  return next
}

function enhanceSchema(schema, title) {
  if (!schema || typeof schema !== 'object') return schema
  const next = { ...schema, title: schema.title || title }
  if (next.properties) next.properties = Object.fromEntries(Object.entries(next.properties).filter(([, value]) => !value.readOnly).map(([key, value]) => [key, enhanceSchema(value, humanize(key))]))
  if (next.items) next.items = enhanceSchema(next.items, 'Item')
  return next
}

function schemaUi(schema, resourceKind) {
  const ui = { 'ui:submitButtonOptions': { norender: true } }
  const walk = (node, target, parent = '') => Object.entries(node?.properties || {}).forEach(([key, child]) => {
    target[key] ||= {}
    if (child.format === 'uri') target[key]['ui:placeholder'] = 'https://…'
    if (/script|command|content/i.test(key)) target[key]['ui:widget'] = key === 'script' ? ShellScriptWidget : 'textarea'
    if (/password|private|secret/i.test(key) && child.type === 'string') target[key]['ui:widget'] = 'password'
    if (resourceKind === 'Command' && parent === 'inventoryCaptureGroupRef' && key === 'name') target[key]['ui:widget'] = InventoryCaptureGroupNameWidget
    if (child.properties) walk(child, target[key], key)
    if (child.items?.properties) { target[key].items ||= {}; walk(child.items, target[key].items, key) }
  })
  walk(schema, ui)
  return ui
}

function inventoryTargets(resource) {
  const hosts = new Map()
  Object.entries(resource?.status?.inventory || {}).forEach(([group, inventory]) => {
    Object.entries(inventory?.hosts || {}).forEach(([name, details]) => {
      const current = hosts.get(name) || { name, address: details?.ansible_host || '', fqdn: details?.fqdn || '', groups: [] }
      if (!current.address) current.address = details?.ansible_host || ''
      if (!current.fqdn) current.fqdn = details?.fqdn || ''
      if (!current.groups.includes(group)) current.groups.push(group)
      hosts.set(name, current)
    })
  })
  const byName = (left, right) => left.localeCompare(right, undefined, { numeric: true })
  const values = [...hosts.values()].sort((left, right) => byName(left.name, right.name))
  values.forEach((host) => host.groups.sort((left, right) => left === 'all' ? -1 : right === 'all' ? 1 : byName(left, right)))
  const groups = [...new Set(values.flatMap((host) => host.groups))].sort((left, right) => left === 'all' ? -1 : right === 'all' ? 1 : byName(left, right))
  return { hosts: values, groups }
}

function InventoryCaptureGroupNameWidget({ value = '', onChange, required, disabled, readonly, rawErrors = [], registry }) {
  const { resources = [], catalog = {}, catalogLoading = false } = registry?.formContext || {}
  const definition = resources.find((entry) => entry.kind === 'InventoryCaptureGroup')
  const cached = (catalog.InventoryCaptureGroup || []).find((item) => item.metadata?.name === value)
  const [state, setState] = useState({ loading: false, item: null, error: '' })
  const [query, setQuery] = useState('')
  const [expanded, { open, close }] = useDisclosure(false)
  const load = useCallback(async () => {
    if (!value || !definition) { setState({ loading: false, item: null, error: '' }); return }
    setState((current) => ({ loading: true, item: current.item?.metadata?.name === value ? current.item : cached || null, error: '' }))
    try { const { body } = await apiFetch(`${definition.path}/${encodeURIComponent(value)}`); setState({ loading: false, item: body, error: '' }) }
    catch (caught) { setState((current) => ({ loading: false, item: current.item, error: caught.message })) }
  }, [cached, definition, value])
  useEffect(() => { const timeout = setTimeout(load, 150); return () => clearTimeout(timeout) }, [load])
  useEffect(() => { setQuery('') }, [value])

  const item = state.item || cached
  const targets = useMemo(() => inventoryTargets(item), [item])
  const omitted = item?.status?.omittedResources || item?.status?.omittedServers || []
  const stale = item?.status?.observedGeneration != null && item.status.observedGeneration !== item.metadata?.generation
  const visibleHosts = targets.hosts.filter((host) => `${host.name} ${host.address} ${host.fqdn} ${host.groups.join(' ')}`.toLowerCase().includes(query.toLowerCase()))
  const copyTarget = async (target) => { try { await navigator.clipboard.writeText(target); showNotice(`Copied Ansible target “${target}”`) } catch (caught) { showNotice(caught.message, 'error') } }
  const rows = visibleHosts.map((host) => <Table.Tr key={host.name}><Table.Td><Group gap={5} wrap="nowrap"><Text fw={650} size="sm">{host.name}</Text><Tooltip label="Copy host target"><ActionIcon size="xs" variant="subtle" color="gray" onClick={() => copyTarget(host.name)}><Copy size={12} /></ActionIcon></Tooltip></Group></Table.Td><Table.Td><Code>{host.address || '—'}</Code></Table.Td><Table.Td><Text size="sm">{host.fqdn || '—'}</Text></Table.Td><Table.Td><Group gap={4}>{host.groups.map((group) => <Badge key={group} size="xs" variant="light" tt="none">{group}</Badge>)}</Group></Table.Td></Table.Tr>)
  const targetTable = (height) => <ScrollArea h={height}><Table verticalSpacing="xs" highlightOnHover stickyHeader><Table.Thead><Table.Tr><Table.Th>Host target</Table.Th><Table.Th>Address</Table.Th><Table.Th>FQDN</Table.Th><Table.Th>Groups</Table.Th></Table.Tr></Table.Thead><Table.Tbody>{rows}</Table.Tbody></Table></ScrollArea>

  const options = (catalog.InventoryCaptureGroup || []).map((group) => ({ value: group.metadata.name, label: group.metadata.name })).sort((left, right) => left.label.localeCompare(right.label))
  return <Stack gap="sm">
    {options.length || catalogLoading ? <Select label="Inventory capture group" description="The reconciled Ansible inventory available to this command" required={required} searchable data={options} value={value || null} onChange={(next) => onChange(next || undefined)} disabled={disabled || readonly} rightSection={catalogLoading ? <Loader size={14} /> : undefined} error={rawErrors[0]} /> : <TextInput label="Inventory capture group" required={required} value={value} onChange={(event) => onChange(event.currentTarget.value)} disabled={disabled || readonly} error={rawErrors[0]} />}
    {value && <Paper withBorder radius="md" p="md" bg="var(--mantine-color-default-hover)">
      <Group justify="space-between" align="flex-start" mb="sm"><Group gap="sm"><ThemeIcon variant="light"><Users size={17} /></ThemeIcon><Box><Text fw={700}>Available Ansible targets</Text><Text size="xs" c="dimmed">The inventory currently generated for {value}.</Text></Box></Group><Group gap="xs"><Badge variant="light">{targets.hosts.length} hosts</Badge><Tooltip label="Refresh inventory"><ActionIcon variant="subtle" onClick={load} loading={state.loading}><RefreshCw size={15} /></ActionIcon></Tooltip></Group></Group>
      {state.error && <Alert color="red" mb="sm">Could not refresh the inventory: {state.error}</Alert>}
      {stale && <Alert icon={<AlertTriangle size={16} />} color="yellow" mb="sm">This preview is from an older generation of the capture group and may change after reconciliation.</Alert>}
      {targets.groups.length > 0 && <Group gap="xs" mb="sm"><Text size="xs" c="dimmed" fw={650}>GROUP TARGETS</Text>{targets.groups.map((group) => <Button key={group} size="compact-xs" variant="light" leftSection={<Copy size={11} />} onClick={() => copyTarget(group)}>{group}</Button>)}</Group>}
      {state.loading && !item ? <Skeleton height={120} /> : targets.hosts.length ? <><TextInput leftSection={<Search size={14} />} placeholder="Filter hosts or groups…" value={query} onChange={(event) => setQuery(event.currentTarget.value)} size="xs" mb="xs" />{targetTable(220)}<Group justify="flex-end" mt="xs"><Button variant="subtle" size="compact-xs" onClick={open}>Expand inventory</Button></Group></> : <Text size="sm" c="dimmed" py="md" ta="center">No usable hosts have been captured yet.</Text>}
      {omitted.length > 0 && <Box component="details" mt="sm"><Text component="summary" size="sm" c="orange" fw={650} style={{ cursor: 'pointer' }}>{omitted.length} selected {omitted.length === 1 ? 'resource was' : 'resources were'} omitted</Text><Stack gap="xs" mt="xs">{omitted.map((entry, index) => <Paper key={`${entry.kind}-${entry.name}-${index}`} withBorder p="xs"><Text size="sm" fw={650}>{entry.kind ? `${entry.kind}/` : ''}{entry.name}</Text><Text size="xs" c="dimmed">{entry.reason}{entry.message ? ` · ${entry.message}` : ''}</Text></Paper>)}</Stack></Box>}
      <Modal opened={expanded} onClose={close} title={`Ansible targets · ${value}`} size="calc(100vw - 3rem)"><Group justify="space-between" mb="sm"><Text size="sm" c="dimmed">{targets.hosts.length} usable hosts across {targets.groups.length} groups</Text><TextInput leftSection={<Search size={14} />} placeholder="Filter targets…" value={query} onChange={(event) => setQuery(event.currentTarget.value)} size="xs" w={320} /></Group>{targetTable('calc(100vh - 190px)')}</Modal>
    </Paper>}
  </Stack>
}

const resourceStatus = (item) => item?.metadata?.deletionTimestamp ? 'Terminating' : item?.kind === 'Server' ? serverProvisioningPhase(item) : item?.status?.phase || 'Active'
const statusColor = (status) => {
  const value = String(status).toLowerCase()
  if (['ready', 'active', 'healthy', 'bound', 'succeeded'].some((word) => value.includes(word))) return 'green'
  if (['failed', 'error', 'degraded', 'conflict', 'blocked'].some((word) => value.includes(word))) return 'red'
  return 'yellow'
}

function showNotice(message, type = 'success') {
  notifications.show({ title: type === 'error' ? 'Request failed' : 'Done', message, color: type === 'error' ? 'red' : 'green' })
}

function PageTitle({ overline, title, description, back, actions }) {
  return <Group justify="space-between" align="flex-end" gap="xl" mb="xl" wrap="wrap">
    <Box>
      {back && <Button variant="subtle" size="compact-sm" leftSection={<ArrowLeft size={15} />} onClick={back} mb="xs">Back</Button>}
      {overline && <Text size="xs" fw={800} c="indigo" tt="uppercase" lts=".09em" mb={4}>{overline}</Text>}
      <Title order={1} size="h2">{title}</Title>
      {description && <Text c="dimmed" mt={6} maw={680}>{description}</Text>}
    </Box>
    {actions && <Group gap="sm">{actions}</Group>}
  </Group>
}

function StatusBadge({ status }) { return <Badge color={statusColor(status)} variant="light" radius="sm">{status}</Badge> }

function Sidebar({ resources, route, close }) {
  return <Stack h="100%" gap={0}>
    <Group h={64} px="lg" wrap="nowrap"><ThemeIcon size={38} radius="md" variant="gradient" gradient={{ from: 'indigo', to: 'cyan' }}><CircleDot size={20} /></ThemeIcon><Text fw={800} size="lg">Stigmergy</Text></Group>
    <Divider />
    <AppShell.Section grow component={ScrollArea} p="sm">
      <NavLink label="Overview" leftSection={<Home size={18} />} active={!route[0]} onClick={() => { navigate(); close() }} variant="light" />
      {groups.map(([label, kinds, GroupIcon]) => {
        const items = resources.filter((resource) => kinds.includes(resource.kind))
        return items.length ? <Box key={label} mt="lg"><Group gap={7} px="sm" mb={5}><GroupIcon size={13} /><Text size="xs" fw={750} c="dimmed" tt="uppercase" lts=".06em">{label}</Text></Group>{items.map((resource) => <NavLink key={resource.kind} label={resource.label} active={route[0] === 'resources' && route[1] === resource.slug} onClick={() => { navigate(`resources/${resource.slug}`); close() }} variant="light" />)}</Box> : null
      })}
      <Box mt="lg"><Group gap={7} px="sm" mb={5}><HardDrive size={13} /><Text size="xs" fw={750} c="dimmed" tt="uppercase" lts=".06em">Artifacts</Text></Group><NavLink component="a" href={FILE_REGISTRY_URL} target="_blank" rel="noreferrer" label="File registry" leftSection={<Package size={17} />} rightSection={<ExternalLink size={13} />} onClick={close} variant="light" /></Box>
      <Box mt="lg"><Group gap={7} px="sm" mb={5}><Settings2 size={13} /><Text size="xs" fw={750} c="dimmed" tt="uppercase" lts=".06em">Developer</Text></Group><NavLink label="API Explorer" leftSection={<Code2 size={17} />} active={route[0] === 'explorer'} onClick={() => { navigate('explorer'); close() }} variant="light" /></Box>
    </AppShell.Section>
    <Divider /><Button component="a" href="/openapi.json" target="_blank" variant="subtle" color="gray" size="compact-sm" rightSection={<ExternalLink size={13} />} m="md">OpenAPI specification</Button>
  </Stack>
}

function Layout({ resources, route, readiness, opened, toggle, close, children }) {
  const { setColorScheme } = useMantineColorScheme(); const scheme = useComputedColorScheme('light')
  return <AppShell header={{ height: 64 }} navbar={{ width: 270, breakpoint: 'md', collapsed: { mobile: !opened } }} padding={{ base: 'md', sm: 'xl' }}>
    <AppShell.Header><Group h="100%" px={{ base: 'md', md: 'xl' }}><Burger opened={opened} onClick={toggle} hiddenFrom="md" size="sm" /><Text fw={800} hiddenFrom="md">Stigmergy</Text><Box style={{ flex: 1 }} /><Tooltip label={`Use ${scheme === 'dark' ? 'light' : 'dark'} theme`}><ActionIcon variant="subtle" color="gray" size="lg" onClick={() => setColorScheme(scheme === 'dark' ? 'light' : 'dark')}>{scheme === 'dark' ? <Sun size={18} /> : <Moon size={18} />}</ActionIcon></Tooltip><Tooltip label={readiness.message}><Badge color={readiness.status === 'good' ? 'green' : readiness.status === 'loading' ? 'gray' : 'red'} variant="light" size="lg">{readiness.status === 'good' ? 'API ready' : readiness.status === 'loading' ? 'Checking API' : 'API offline'}</Badge></Tooltip></Group></AppShell.Header>
    <AppShell.Navbar><Sidebar resources={resources} route={route} close={close} /></AppShell.Navbar>
    <AppShell.Main bg="var(--mantine-color-body)"><Box maw={1380} mx="auto">{children}</Box></AppShell.Main>
  </AppShell>
}

function Dashboard({ resources, readiness }) {
  const [summary, setSummary] = useState({ loading: true, counts: {}, total: 0, problems: 0 })
  useEffect(() => { let active = true; Promise.all(resources.map(async (resource) => { try { const { body } = await apiFetch(resource.path); return [resource.kind, body.items || []] } catch { return [resource.kind, []] } })).then((results) => { if (!active) return; const counts = Object.fromEntries(results.map(([kind, items]) => [kind, items.length])); const all = results.flatMap(([, items]) => items); setSummary({ loading: false, counts, total: all.length, problems: all.filter((item) => statusColor(resourceStatus(item)) === 'red').length }) }); return () => { active = false } }, [resources])
  const stats = [['API status', readiness.status === 'good' ? 'Ready' : 'Unavailable', readiness.message], ['Total resources', summary.loading ? '—' : summary.total, `Across ${resources.length} resource kinds`], ['Needs attention', summary.loading ? '—' : summary.problems, 'Resources reporting a failure']]
  return <><PageTitle overline="Control plane" title="Homelab overview" description="Manage declared infrastructure, automation, inventory, and credentials." />
    <SimpleGrid cols={{ base: 1, sm: 3 }} mb={42}>{stats.map(([label, value, detail], index) => <Paper key={label} withBorder p="xl" radius="lg" bg={index === 0 ? 'indigo.6' : undefined} c={index === 0 ? 'white' : undefined}><Text size="sm" opacity={.72}>{label}</Text><Text size="32px" fw={750} mt="md">{value}</Text><Text size="xs" opacity={.65} truncate>{detail}</Text></Paper>)}</SimpleGrid>
    <Title order={2} size="h4">Resources</Title><Text c="dimmed" size="sm" mb="md">Choose a type to inspect or change desired state.</Text>
    <SimpleGrid cols={{ base: 1, sm: 2, xl: 3 }} spacing="sm">{resources.map((resource) => <Card key={resource.kind} withBorder radius="md" padding={0}><Card.Section component="button" className="resource-card-button" onClick={() => navigate(`resources/${resource.slug}`)}><Group wrap="nowrap" p="md"><ThemeIcon size={42} radius="md" variant="light" color="indigo"><Boxes size={19} /></ThemeIcon><Box style={{ flex: 1, minWidth: 0 }}><Text fw={700} truncate>{resource.label}</Text><Text size="xs" c="dimmed">{summary.counts[resource.kind] ?? '—'} configured</Text></Box><ChevronRight size={17} /></Group></Card.Section></Card>)}</SimpleGrid>
  </>
}

function Loading() { return <Stack>{[1, 2, 3].map((key) => <Skeleton key={key} height={72} radius="md" />)}</Stack> }
function ErrorView({ message, retry }) { return <Alert color="red" title="Could not load this view" withCloseButton={false}>{message}{retry && <Button color="red" variant="light" size="xs" mt="sm" onClick={retry}>Try again</Button>}</Alert> }

function ResourceList({ resource }) {
  const mobile = useMediaQuery('(max-width: 48em)'); const [state, setState] = useState({ loading: true, items: [], error: '' }); const [query, setQuery] = useState('')
  const load = useCallback(async () => { setState((value) => ({ ...value, loading: true, error: '' })); try { const { body } = await apiFetch(resource.path); setState({ loading: false, items: body.items || [], error: '' }) } catch (error) { setState({ loading: false, items: [], error: error.message }) } }, [resource.path])
  useEffect(() => { load() }, [load])
  const items = state.items.filter((item) => `${item.metadata?.name} ${resourceStatus(item)} ${Object.values(item.metadata?.labels || {}).join(' ')}`.toLowerCase().includes(query.toLowerCase()))
  const provisioningAction = (item) => resource.kind === 'Server' ? <Group gap="xs"><ServerAgentPulse item={item} resourcePath={resource.path} apiFetch={apiFetch} /><ServerRebootButton item={item} resourcePath={resource.path} apiFetch={apiFetch} compact onRequested={({ body }) => showNotice(`${body.metadata.name} queued`)} /><ServerProvisionButton item={item} resourcePath={resource.path} apiFetch={apiFetch} compact onRequested={({ body }) => { showNotice(`${body.metadata.name} queued`); load() }} /></Group> : null
  const actions = <><Button variant="default" leftSection={<RefreshCw size={15} />} onClick={load}>Refresh</Button><Button leftSection={<Plus size={16} />} onClick={() => navigate(`resources/${resource.slug}/new`)}>Create</Button></>
  return <><PageTitle overline="Resources" title={resource.label} description={`Manage ${humanize(resource.kind).toLowerCase()} desired state and controller status.`} actions={actions} />
    <Group justify="space-between" align="center" mb="md"><TextInput leftSection={<Search size={16} />} placeholder={`Search ${resource.label.toLowerCase()}…`} value={query} onChange={(event) => setQuery(event.currentTarget.value)} w={{ base: '100%', sm: 420 }} /><Text size="xs" c="dimmed">{items.length} results</Text></Group>
    {state.error ? <ErrorView message={state.error} retry={load} /> : state.loading ? <Loading /> : !state.items.length ? <Paper withBorder radius="lg" py={70} px="xl" ta="center"><ThemeIcon size={54} radius="lg" variant="light" mb="md"><Boxes /></ThemeIcon><Title order={3}>No {resource.label.toLowerCase()} yet</Title><Text c="dimmed" mb="lg">Create the first {humanize(resource.kind).toLowerCase()}.</Text><Button leftSection={<Plus size={16} />} onClick={() => navigate(`resources/${resource.slug}/new`)}>Create resource</Button></Paper> : mobile ? <Stack gap="sm">{items.map((item) => <Card key={item.metadata.name} withBorder onClick={() => navigate(`resources/${resource.slug}/${encodeURIComponent(item.metadata.name)}`)} className="clickable-card"><Group wrap="nowrap"><Box style={{ flex: 1, minWidth: 0 }}><Text fw={700}>{item.metadata.name}</Text><Text size="xs" c="dimmed">Generation {item.metadata.generation ?? '—'}</Text></Box><StatusBadge status={resourceStatus(item)} />{provisioningAction(item)}<ChevronRight size={17} /></Group></Card>)}</Stack> : <Table.ScrollContainer minWidth={760}><Table striped highlightOnHover withTableBorder verticalSpacing="md"><Table.Thead><Table.Tr><Table.Th>Name</Table.Th><Table.Th>Status</Table.Th><Table.Th>Generation</Table.Th><Table.Th>Created</Table.Th><Table.Th /></Table.Tr></Table.Thead><Table.Tbody>{items.map((item) => <Table.Tr key={item.metadata.name} onClick={() => navigate(`resources/${resource.slug}/${encodeURIComponent(item.metadata.name)}`)} className="clickable-row"><Table.Td><Text fw={700}>{item.metadata.name}</Text><Text size="xs" c="dimmed">{Object.entries(item.metadata.labels || {}).slice(0, 2).map(([key, value]) => `${key}=${value}`).join(' · ')}</Text></Table.Td><Table.Td><StatusBadge status={resourceStatus(item)} /></Table.Td><Table.Td>{item.metadata.generation ?? '—'}</Table.Td><Table.Td>{item.metadata.creationTimestamp ? new Date(item.metadata.creationTimestamp).toLocaleString() : '—'}</Table.Td><Table.Td><Group justify="flex-end" wrap="nowrap">{provisioningAction(item)}<ChevronRight size={17} /></Group></Table.Td></Table.Tr>)}</Table.Tbody></Table></Table.ScrollContainer>}
  </>
}

function KeyValues({ label, value = {}, onChange }) {
  const rows = Object.entries(value); const change = (index, field, next) => onChange(Object.fromEntries(rows.map((row, rowIndex) => rowIndex === index ? (field === 0 ? [next, row[1]] : [row[0], next]) : row).filter(([key]) => key)))
  return <Box mt="xl"><Text size="sm" fw={600} mb="xs">{label}</Text><Stack gap="xs">{rows.map(([key, val], index) => <Group key={`${key}-${index}`} gap="xs" wrap="nowrap"><TextInput size="sm" placeholder="Key" value={key} onChange={(event) => change(index, 0, event.currentTarget.value)} style={{ flex: 1 }} /><TextInput size="sm" placeholder="Value" value={val} onChange={(event) => change(index, 1, event.currentTarget.value)} style={{ flex: 1 }} /><ActionIcon color="red" variant="subtle" onClick={() => onChange(Object.fromEntries(rows.filter((_, rowIndex) => rowIndex !== index)))}><X size={16} /></ActionIcon></Group>)}</Stack><Button variant="subtle" size="compact-sm" leftSection={<Plus size={14} />} mt="xs" onClick={() => onChange({ ...value, [`key-${rows.length + 1}`]: '' })}>Add {label.toLowerCase().replace(/s$/, '')}</Button></Box>
}

function ResourceEditor({ resource, resources, spec, name }) {
  const editing = Boolean(name); const components = spec.components?.schemas || {}; const baseSchema = useMemo(() => enhanceSchema(dereference(components[resource.specSchema], components), `${humanize(resource.kind)} settings`), [components, resource])
  const [data, setData] = useState({ name: '', labels: {}, annotations: {}, spec: {} }); const [etag, setEtag] = useState(''); const [loading, setLoading] = useState(editing); const [saving, setSaving] = useState(false); const [mode, setMode] = useState('form'); const [raw, setRaw] = useState(''); const [error, setError] = useState(''); const [catalog, setCatalog] = useState({}); const [catalogLoading, setCatalogLoading] = useState(true)
  const schema = useMemo(() => addResourceChoices(baseSchema, data.spec, resources, catalog), [baseSchema, catalog, data.spec, resources])
  const manifest = useMemo(() => ({ apiVersion: resource.apiVersion, kind: resource.kind, metadata: { name: data.name, ...(Object.keys(data.labels).length ? { labels: data.labels } : {}), ...(Object.keys(data.annotations).length ? { annotations: data.annotations } : {}) }, spec: data.spec }), [data, resource])
  useEffect(() => { let active = true; setCatalogLoading(true); Promise.all(resources.map(async (entry) => { try { const { body } = await apiFetch(entry.path); return [entry.kind, body.items || []] } catch { return [entry.kind, []] } })).then((entries) => { if (active) { setCatalog(Object.fromEntries(entries)); setCatalogLoading(false) } }); return () => { active = false } }, [resources])
  useEffect(() => { if (!editing) { setRaw(JSON.stringify(manifest, null, 2)); return }; apiFetch(`${resource.path}/${encodeURIComponent(name)}`).then(({ body, response }) => { const next = { name: body.metadata.name, labels: body.metadata.labels || {}, annotations: body.metadata.annotations || {}, spec: body.spec || {} }; setData(next); setEtag(response.headers.get('etag') || `"${body.metadata.resourceVersion}"`); setRaw(JSON.stringify({ apiVersion: body.apiVersion, kind: body.kind, metadata: { name: body.metadata.name, labels: next.labels, annotations: next.annotations }, spec: body.spec }, null, 2)); setLoading(false) }).catch((caught) => { setError(caught.message); setLoading(false) }) }, [editing, name, resource.path])
  useEffect(() => { if (mode === 'form') setRaw(JSON.stringify(manifest, null, 2)) }, [manifest, mode])
  const switchMode = (next) => { if (next === 'form' && mode === 'json') { try { const parsed = JSON.parse(raw); setData({ name: parsed.metadata?.name || '', labels: parsed.metadata?.labels || {}, annotations: parsed.metadata?.annotations || {}, spec: parsed.spec || {} }); setError('') } catch (caught) { setError(`Manifest JSON is invalid: ${caught.message}`); return } }; if (next === 'json') setRaw(JSON.stringify(manifest, null, 2)); setMode(next) }
  const save = async () => { setError(''); setSaving(true); let payload = manifest; if (mode === 'json') { try { payload = JSON.parse(raw) } catch (caught) { setError(`Manifest JSON is invalid: ${caught.message}`); setSaving(false); return } }; if (!payload.metadata?.name || !/^[a-z0-9](?:[-a-z0-9.]{0,251}[a-z0-9])?$/.test(payload.metadata.name)) { setError('Name must be a valid lowercase DNS-style name.'); setSaving(false); return }; const validation = validator.validateFormData(payload.spec || {}, baseSchema); if (validation.errors.length) { setError(validation.errors[0].stack); setMode('form'); setSaving(false); return }; try { const headers = { 'Content-Type': 'application/json', ...(editing && etag ? { 'If-Match': etag } : {}) }; const { body } = await apiFetch(editing ? `${resource.path}/${encodeURIComponent(name)}` : resource.path, { method: editing ? 'PUT' : 'POST', headers, body: JSON.stringify(payload) }); showNotice(`${body.metadata.name} ${editing ? 'updated' : 'created'}`); navigate(`resources/${resource.slug}/${encodeURIComponent(body.metadata.name)}`) } catch (caught) { setError(caught.status === 409 ? 'This resource changed while you were editing it. Reload and try again.' : caught.message) } finally { setSaving(false) } }
  if (loading) return <Loading />
  const actions = <><Button variant="default" onClick={() => navigate(editing ? `resources/${resource.slug}/${encodeURIComponent(name)}` : `resources/${resource.slug}`)}>Cancel</Button><Button leftSection={saving ? <Loader size={14} color="white" /> : <Check size={15} />} disabled={saving} onClick={save}>{editing ? 'Save changes' : 'Create resource'}</Button></>
  return <><PageTitle overline={resource.label} title={editing ? `Edit ${name}` : `Create ${humanize(resource.kind)}`} description="Edit desired state with guided fields or the complete JSON manifest." back={() => navigate(editing ? `resources/${resource.slug}/${encodeURIComponent(name)}` : `resources/${resource.slug}`)} actions={actions} />{error && <Alert color="red" mb="md">{error}</Alert>}<SegmentedControl value={mode} onChange={switchMode} data={[{ value: 'form', label: 'Guided form' }, { value: 'json', label: 'Manifest JSON' }]} mb="md" />{mode === 'json' ? <Paper withBorder radius="md" p="lg"><JsonInput label="Resource manifest" value={raw} onChange={setRaw} validationError="Invalid JSON" formatOnBlur autosize minRows={20} styles={{ input: { fontFamily: 'ui-monospace, monospace', fontSize: 13 } }} /></Paper> : <SimpleGrid cols={{ base: 1, lg: 2 }} spacing="md" className="editor-grid"><Paper withBorder radius="md" p="xl" className="identity-panel"><Title order={2} size="h4">Identity</Title><Text size="sm" c="dimmed" mb="lg">Stable name and optional organization metadata.</Text><TextInput label="Name" required disabled={editing} value={data.name} onChange={(event) => setData({ ...data, name: event.currentTarget.value })} description="Lowercase DNS-style name" /><KeyValues label="Labels" value={data.labels} onChange={(labels) => setData({ ...data, labels })} /><KeyValues label="Annotations" value={data.annotations} onChange={(annotations) => setData({ ...data, annotations })} /></Paper><Paper withBorder radius="md" p={{ base: 'md', sm: 'xl' }}>{catalogLoading && <Group gap="xs" mb="md"><Loader size="xs" /><Text size="xs" c="dimmed">Loading resource choices…</Text></Group>}<Form schema={schema} formData={data.spec} validator={validator} uiSchema={schemaUi(schema, resource.kind)} formContext={{ resources, catalog, catalogLoading }} showErrorList={false} onChange={({ formData }) => setData({ ...data, spec: formData })}><></></Form></Paper></SimpleGrid>}</>
}

function JsonView({ value }) { return <Paper withBorder radius="md" style={{ overflow: 'hidden' }}><Group justify="space-between" px="md" py="xs" style={{ borderBottom: '1px solid var(--mantine-color-default-border)' }}><Text size="xs" fw={750} c="dimmed">JSON</Text><Button variant="subtle" size="compact-xs" onClick={() => navigator.clipboard.writeText(JSON.stringify(value, null, 2))}>Copy</Button></Group><ScrollArea><Code block p="lg" bg="transparent" style={{ minHeight: 280 }}>{JSON.stringify(value, null, 2)}</Code></ScrollArea></Paper> }

function ResourceDetail({ resource, name }) {
  const [state, setState] = useState({ loading: true, item: null, etag: '', error: '' }); const [tab, setTab] = useState('overview'); const [confirm, { open: openConfirm, close: closeConfirm }] = useDisclosure(false); const [deleting, setDeleting] = useState(false)
  const load = useCallback(async () => { setState((value) => ({ ...value, loading: true })); try { const { body, response } = await apiFetch(`${resource.path}/${encodeURIComponent(name)}`); setState({ loading: false, item: body, etag: response.headers.get('etag') || `"${body.metadata.resourceVersion}"`, error: '' }) } catch (caught) { setState({ loading: false, item: null, etag: '', error: caught.message }) } }, [name, resource.path])
  useEffect(() => { load() }, [load])
  const remove = async () => { setDeleting(true); try { await apiFetch(`${resource.path}/${encodeURIComponent(name)}`, { method: 'DELETE', headers: { 'If-Match': state.etag } }); showNotice(`${name} deletion requested`); navigate(`resources/${resource.slug}`) } catch (caught) { showNotice(caught.message, 'error'); setDeleting(false); closeConfirm() } }
  if (state.loading) return <Loading />; if (state.error) return <ErrorView message={state.error} retry={load} />
  const item = state.item; const actions = <><Button variant="default" leftSection={<RefreshCw size={15} />} onClick={load}>Refresh</Button>{resource.kind === 'Server' && <ServerRebootButton item={item} resourcePath={resource.path} apiFetch={apiFetch} onRequested={({ body }) => showNotice(`${body.metadata.name} queued`)} />}{resource.kind === 'Server' && <ServerProvisionButton item={item} resourcePath={resource.path} apiFetch={apiFetch} onRequested={({ body }) => { showNotice(`${body.metadata.name} queued`); load() }} />}<Button onClick={() => navigate(`resources/${resource.slug}/${encodeURIComponent(name)}/edit`)}>Edit</Button><Button color="red" variant="subtle" leftSection={<Trash2 size={15} />} onClick={openConfirm}>Delete</Button></>
  return <><PageTitle overline={resource.label} title={name} description={`${resource.kind} · generation ${item.metadata.generation ?? '—'}`} back={() => navigate(`resources/${resource.slug}`)} actions={actions} />{resource.kind === 'Server' && <Group mb="md"><Text size="sm">homelabd</Text><ServerAgentPulse item={item} resourcePath={resource.path} apiFetch={apiFetch} /></Group>}<SimpleGrid cols={{ base: 2, lg: 4 }} mb="lg">{[['Status', <StatusBadge status={resourceStatus(item)} />], ['Resource version', item.metadata.resourceVersion], ['Created', item.metadata.creationTimestamp ? new Date(item.metadata.creationTimestamp).toLocaleString() : '—'], ['UID', item.metadata.uid || '—']].map(([label, value]) => <Paper withBorder p="md" radius="md" key={label}><Text size="xs" c="dimmed">{label}</Text><Box mt={6} style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{value}</Box></Paper>)}</SimpleGrid>{resource.kind === 'Server' && <ServerProvisionProgress item={item} resourcePath={resource.path} apiFetch={apiFetch} onUpdate={({ body, response }) => setState(value => value.item && acceptProvisioningUpdate(value.item, body) ? { ...value, item: body, etag: response.headers.get('etag') || `"${body.metadata.resourceVersion}"` } : value)} />}<Tabs value={tab} onChange={setTab}><Tabs.List mb="md"><Tabs.Tab value="overview">Overview</Tabs.Tab><Tabs.Tab value="spec">Desired state</Tabs.Tab><Tabs.Tab value="status">Observed status</Tabs.Tab><Tabs.Tab value="raw">Raw</Tabs.Tab></Tabs.List><Tabs.Panel value="overview"><SimpleGrid cols={{ base: 1, md: 2 }}><Paper withBorder p="xl" radius="md"><Title order={2} size="h4" mb="md">Metadata</Title>{[['Name', item.metadata.name], ['Kind', item.kind], ['API version', item.apiVersion], ['Generation', item.metadata.generation]].map(([key, value]) => <Group justify="space-between" py="xs" key={key} style={{ borderBottom: '1px solid var(--mantine-color-default-border)' }}><Text size="sm" c="dimmed">{key}</Text><Text size="sm" fw={600}>{value}</Text></Group>)}</Paper><Paper withBorder p="xl" radius="md"><Title order={2} size="h4" mb="md">Labels & annotations</Title><Group gap="xs">{[...Object.entries(item.metadata.labels || {}), ...Object.entries(item.metadata.annotations || {})].map(([key, value]) => <Badge key={`${key}-${value}`} variant="default" tt="none">{key}={value}</Badge>)}{!Object.keys(item.metadata.labels || {}).length && !Object.keys(item.metadata.annotations || {}).length && <Text c="dimmed">No metadata tags</Text>}</Group></Paper></SimpleGrid></Tabs.Panel><Tabs.Panel value="spec"><JsonView value={item.spec} /></Tabs.Panel><Tabs.Panel value="status"><JsonView value={item.status || { message: 'No observed status yet.' }} /></Tabs.Panel><Tabs.Panel value="raw"><JsonView value={item} /></Tabs.Panel></Tabs><Modal opened={confirm} onClose={closeConfirm} title={<Text fw={700}>Delete {name}?</Text>} centered><Text c="dimmed" size="sm">This can trigger controller cleanup and cannot be undone.</Text><Group justify="flex-end" mt="xl"><Button variant="default" onClick={closeConfirm}>Cancel</Button><Button color="red" loading={deleting} onClick={remove}>Delete</Button></Group></Modal></>
}

function ApiExplorer({ spec }) {
  const operations = useMemo(() => Object.entries(spec.paths || {}).flatMap(([path, item]) => Object.entries(item).filter(([method]) => ['get', 'post', 'put', 'patch', 'delete'].includes(method)).map(([method, operation]) => ({ path, method: method.toUpperCase(), ...operation }))), [spec])
  const [selected, setSelected] = useState(operations[0]); const [values, setValues] = useState({}); const [headers, setHeaders] = useState({}); const [body, setBody] = useState('{}'); const [result, setResult] = useState(null); const [sending, setSending] = useState(false); const [confirm, { open: openConfirm, close: closeConfirm }] = useDisclosure(false)
  if (!selected) return null
  const parameters = [...(spec.paths[selected.path]?.parameters || []), ...(selected.parameters || [])]
  const send = async (confirmed = false) => { if (selected.method === 'DELETE' && !confirmed) { openConfirm(); return }; closeConfirm(); let path = selected.path; Object.entries(values).forEach(([key, value]) => { path = path.replace(`{${key}}`, encodeURIComponent(value)) }); setSending(true); try { const requestHeaders = { ...headers }; const options = { method: selected.method, headers: requestHeaders }; if (!['GET', 'DELETE'].includes(selected.method) || body.trim() !== '{}') { requestHeaders['Content-Type'] = selected.method === 'PATCH' ? 'application/merge-patch+json' : 'application/json'; options.body = body }; const start = performance.now(); const response = await authorizedFetch(path, options); const text = await response.text(); let parsed = text; try { parsed = JSON.parse(text) } catch { /* plain text */ }; setResult({ status: response.status, ok: response.ok, duration: Math.round(performance.now() - start), body: parsed }) } catch (caught) { showNotice(caught.message, 'error') } finally { setSending(false) } }
  return <><PageTitle overline="Developer tools" title="API Explorer" description="Inspect and call every operation in the OpenAPI document." /><SimpleGrid cols={{ base: 1, lg: 2 }} spacing="md" className="explorer-grid"><Paper withBorder radius="md" p="xs"><ScrollArea h={{ base: 300, lg: 'calc(100vh - 190px)' }}>{operations.map((operation) => <NavLink key={`${operation.method}-${operation.path}`} active={selected.operationId === operation.operationId} onClick={() => { setSelected(operation); setValues({}); setHeaders({}); setBody('{}'); setResult(null) }} label={operation.summary || operation.operationId} description={operation.path} leftSection={<Badge size="sm" w={58} color={operation.method === 'DELETE' ? 'red' : operation.method === 'GET' ? 'blue' : 'green'} variant="light">{operation.method}</Badge>} />)}</ScrollArea></Paper><Paper withBorder radius="md" p={{ base: 'md', sm: 'xl' }}><Group align="flex-start" wrap="nowrap"><Badge color={selected.method === 'DELETE' ? 'red' : selected.method === 'GET' ? 'blue' : 'green'} size="lg">{selected.method}</Badge><Box><Title order={2} size="h4">{selected.summary}</Title><Code>{selected.path}</Code></Box></Group>{selected.description && <Text c="dimmed" mt="md">{selected.description}</Text>}{parameters.map((parameter) => <TextInput key={`${parameter.in}-${parameter.name}`} label={parameter.name} description={`${parameter.in}${parameter.description ? ` · ${parameter.description}` : ''}`} required={parameter.required} value={(parameter.in === 'header' ? headers : values)[parameter.name] || ''} onChange={(event) => parameter.in === 'header' ? setHeaders({ ...headers, [parameter.name]: event.currentTarget.value }) : setValues({ ...values, [parameter.name]: event.currentTarget.value })} mt="md" />)}{selected.requestBody && <JsonInput label="Request body" value={body} onChange={setBody} validationError="Invalid JSON" formatOnBlur autosize minRows={10} mt="md" styles={{ input: { fontFamily: 'ui-monospace, monospace' } }} />}<Button leftSection={<Activity size={15} />} loading={sending} onClick={() => send()} mt="lg">Send request</Button>{result && <Box mt="xl"><Group mb="xs"><Badge color={result.ok ? 'green' : 'red'}>{result.status}</Badge><Text size="xs" c="dimmed">{result.duration} ms</Text></Group><JsonView value={result.body} /></Box>}</Paper></SimpleGrid><Modal opened={confirm} onClose={closeConfirm} title="Send destructive request?" centered><Text size="sm" c="dimmed">Send DELETE {selected.path}? Verify the path parameters before continuing.</Text><Group justify="flex-end" mt="xl"><Button variant="default" onClick={closeConfirm}>Cancel</Button><Button color="red" onClick={() => send(true)}>Send DELETE</Button></Group></Modal></>
}

export default function AppMantine() {
  const [token, setToken] = useState(sessionApiToken)
  const [tokenRevision, setTokenRevision] = useState(0)
  const route = useHashRoute(); const [spec, setSpec] = useState(EMPTY_SPEC); const [specError, setSpecError] = useState(''); const [readiness, setReadiness] = useState({ status: 'loading', message: 'Checking API…' }); const [opened, { toggle, close }] = useDisclosure(false)
  const resources = useMemo(() => discoverResources(spec), [spec]); const resource = resources.find((entry) => entry.slug === route[1])
  const check = useCallback(async () => { setReadiness({ status: 'loading', message: 'Checking API…' }); try { const result = await apiFetch('/openapi.json'); setSpec(result.body); setSpecError(''); try { const ready = await apiFetch('/readyz'); setReadiness({ status: 'good', message: ready.body.status || 'Ready' }) } catch (error) { setReadiness({ status: 'bad', message: error.message }) } } catch (error) { setSpecError(error.message); setReadiness({ status: 'bad', message: error.message }) } }, [])
  useEffect(() => { check() }, [check])
  let content
  if (specError && !resources.length) content = <Stack align="center" ta="center" py={80}><ThemeIcon size={64} radius="xl" variant="light"><Settings2 /></ThemeIcon><Title order={1}>Connect the Stigmergy API</Title><Text c="dimmed">The console is running, but its API proxy cannot reach Stigmergy.</Text><Alert color="red">{specError}</Alert><Button leftSection={<RefreshCw size={15} />} onClick={check}>Try again</Button></Stack>
  else if (route[0] === 'explorer') content = <ApiExplorer spec={spec} />
  else if (route[0] === 'resources' && resource) content = route[2] === 'new' ? <ResourceEditor resource={resource} resources={resources} spec={spec} /> : route[2] && route[3] === 'edit' ? <ResourceEditor resource={resource} resources={resources} spec={spec} name={decodeURIComponent(route[2])} /> : route[2] ? <ResourceDetail resource={resource} name={decodeURIComponent(route[2])} /> : <ResourceList resource={resource} />
  else content = <Dashboard resources={resources} readiness={readiness} />
  return <Layout key={tokenRevision} resources={resources} route={route} readiness={readiness} opened={opened} toggle={toggle} close={close}><Group align="end" mb="lg"><PasswordInput label="API bearer token" description="Kept only for this browser session" value={token} onChange={(event) => setToken(event.currentTarget.value)} style={{ flex: 1 }} /><Button variant="default" onClick={() => { sessionApiToken = token.trim(); setTokenRevision((value) => value + 1) }}>Connect</Button></Group>{content}</Layout>
}
