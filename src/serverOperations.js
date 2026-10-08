export function rebootBlockReason(server) {
  if (server.metadata?.deletionTimestamp) return 'Server is being deleted.'
  if (!server.metadata?.uid || !server.status?.machineRef?.uid) return 'Waiting for a bound Machine.'
  if (server.status?.provisioning?.maintenance || server.status?.provisioning?.activeRunRef) return 'Provisioning owns this Server.'
  if (server.spec?.reconciliation?.paused) return 'Server reconciliation is paused.'
  if (server.status?.hostSSH?.phase !== 'Ready' || !server.status?.networking?.management?.address?.address) return 'Waiting for verified management SSH.'
  return ''
}

export function agentPulse(server, now = Date.now(), graceMs = 120000) {
  const value = server.status?.agent?.lastSeenTime
  if (!value) return { label: 'Never seen', color: 'gray', reporting: false, description: 'No homelabd report has been received for this bound machine.' }
  const timestamp = Date.parse(value)
  if (!Number.isFinite(timestamp) || timestamp > now + 5000) return { label: 'Unknown', color: 'gray', reporting: false, description: 'Report time is invalid or clocks disagree.' }
  const age = Math.max(0, now - timestamp)
  return { label: age <= graceMs ? 'Reporting' : 'Stale', color: age <= graceMs ? 'green' : 'orange', reporting: age <= graceMs,
    description: `Last API-received homelabd report: ${Math.floor(age / 1000)} seconds ago. Reporting freshness is not proof of SSH or host availability.` }
}

export function executorContainsServer(executor, group, server) {
  return !executor.metadata?.deletionTimestamp && executor.status?.phase === 'Ready'
    && executor.status.observedGeneration === executor.metadata.generation
    && executor.spec.inventoryCaptureGroupRef.name === group.metadata.name
    && (!executor.spec.inventoryCaptureGroupRef.uid || executor.spec.inventoryCaptureGroupRef.uid === group.metadata.uid)
    && !group.metadata.deletionTimestamp && group.status?.observedGeneration === group.metadata.generation
    && Object.values(group.status?.inventory || {}).some(value => Object.hasOwn(value?.hosts || {}, server.metadata.name))
}

function shellQuote(value) { return `'${String(value).replaceAll("'", "'\\''")}'` }

export async function requestServerReboot(apiFetch, resourcePath, server, executor, confirmation, commandName) {
  if (confirmation !== server.metadata.name) throw new Error('Type the exact Server name to confirm reboot.')
  const { body: latest } = await apiFetch(`${resourcePath}/${encodeURIComponent(server.metadata.name)}`)
  if (latest.metadata.uid !== server.metadata.uid || latest.status?.machineRef?.uid !== server.status?.machineRef?.uid) throw new Error('Server or Machine identity changed. Refresh and review.')
  const blocked = rebootBlockReason(latest)
  if (blocked) throw new Error(blocked)
  const base = resourcePath.replace(/\/servers$/, '')
  const { body: currentExecutor } = await apiFetch(`${base}/commands-pipelines/${encodeURIComponent(executor.metadata.name)}`)
  if (currentExecutor.metadata.uid !== executor.metadata.uid) throw new Error('The command executor was replaced. Refresh and review.')
  const { body: group } = await apiFetch(`${base}/inventory-capture-groups/${encodeURIComponent(currentExecutor.spec.inventoryCaptureGroupRef.name)}`)
  if (!executorContainsServer(currentExecutor, group, latest)) throw new Error('The executor no longer captures this Server.')
  const name = commandName || `reboot-${crypto.randomUUID()}`
  const script = `set -euo pipefail\npython3 "$ANSIBLE_ROLES_PATH/../operators/system_operations.py" reboot --server ${shellQuote(latest.metadata.name)} --uid ${shellQuote(latest.metadata.uid)} --machine-uid ${shellQuote(latest.status.machineRef.uid)}\n`
  return apiFetch(`${base}/commands`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ apiVersion: 'homelab.io/v1alpha1', kind: 'Command', metadata: { name,
      labels: { 'homelab.io/operation': 'reboot', 'homelab.io/server-uid': latest.metadata.uid } },
    spec: { commandsPipelineRef: { name: currentExecutor.metadata.name, uid: currentExecutor.metadata.uid }, script } }) })
}
