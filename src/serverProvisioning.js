const activePhases = new Set(['PreparingBoot', 'AwaitingLive', 'Installing', 'AwaitingInstalled', 'Verifying'])

export function serverProvisioningPhase(server) {
  const desired = server.spec?.provisioning || {}
  const status = server.status?.provisioning || {}
  const counter = desired.reprovision ?? 0
  if (status.maintenance || activePhases.has(status.phase)) return status.phase || 'Blocked'
  const terminalCurrentRequest = ['Blocked', 'Succeeded'].includes(status.phase) && status.requestedReprovision === counter
  if (desired.enabled && !terminalCurrentRequest && (!status.provisioned || counter > (status.observedReprovision ?? 0))) return 'Queued'
  return status.phase || server.status?.phase || 'Active'
}

export function provisionBlockReason(server) {
  const desired = server.spec?.provisioning || {}
  const status = server.status?.provisioning || {}
  const os = server.spec?.operatingSystem || {}
  const counter = desired.reprovision ?? 0
  if (server.metadata?.deletionTimestamp) return 'This Server is being deleted.'
  if (status.maintenance || activePhases.has(status.phase)) return 'An attempt owns this Server. Finish or inspect recovery before requesting another.'
  if (server.spec?.reconciliation?.paused) return 'Server reconciliation is paused. Resume it before provisioning.'
  if (!/^\/dev\/disk\/by-id\/[^/]+$/.test(desired.targetDisk || '')) return 'Edit the Server to configure an approved /dev/disk/by-id/ target disk first.'
  if (os.architecture !== 'amd64' || os.bootMode !== 'uefi' || ![['arch', 'rolling'], ['debian', 'trixie']].some(([distribution, version]) => os.distribution === distribution && os.version === version)) return 'Configure a supported amd64 UEFI target: Arch rolling or Debian trixie.'
  if (!server.spec?.boot?.isoRef?.name || !server.spec?.sshCertificateAuthorityRef?.name) return 'Configure the boot ISO and SSH certificate authority first.'
  if (!Number.isSafeInteger(counter) || counter < 0 || counter >= Number.MAX_SAFE_INTEGER) return 'The reprovision counter cannot be safely incremented in this browser.'
  if (!server.metadata?.resourceVersion) return 'Refresh to obtain the Server resource version.'
  const terminalCurrentRequest = ['Blocked', 'Succeeded'].includes(status.phase) && status.requestedReprovision === counter
  if (desired.enabled && !terminalCurrentRequest && (!status.provisioned || counter > (status.observedReprovision ?? 0))) return 'A provisioning request is already pending.'
  return ''
}

export async function requestServerProvision(apiFetch, resourcePath, server, etag, confirmation) {
  const blocked = provisionBlockReason(server)
  if (blocked) throw new Error(blocked)
  if (confirmation !== server.metadata.name) throw new Error('Type the exact Server name to confirm disk replacement.')
  return apiFetch(`${resourcePath}/${encodeURIComponent(server.metadata.name)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/merge-patch+json', 'If-Match': etag || `"${server.metadata.resourceVersion}"` },
    body: JSON.stringify({ provisioning: { enabled: true, reprovision: (server.spec.provisioning.reprovision ?? 0) + 1 } }),
  })
}
