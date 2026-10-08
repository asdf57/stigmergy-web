export function serverProvisioningPhase(server) {
  const status = server.status?.provisioning || {}
  if (status.activeRunRef) return 'Provisioning'
  if (status.maintenance) return 'Blocked'
  return status.provisioned ? 'Provisioned' : server.status?.phase || 'Awaiting installation'
}

export function provisionBlockReason(server, { selectOperatingSystem = false } = {}) {
  const status = server.status?.provisioning || {}
  const os = server.spec?.operatingSystem || {}
  if (server.metadata?.deletionTimestamp) return 'This Server is being deleted.'
  if (status.maintenance || status.activeRunRef) return 'A run owns this Server. Finish or inspect recovery before requesting another.'
  if (!server.spec?.provisioning?.enabled) return 'Enable provisioning in the Server configuration first; enabling it does not erase disks.'
  if (server.spec?.reconciliation?.paused) return 'Server reconciliation is paused.'
  if (!server.status?.machineRef?.uid) return 'Waiting for a discovered Machine binding.'
  if (!Number.isSafeInteger(server.metadata?.generation) || server.metadata.generation < 1) return 'Refresh to obtain the current Server generation.'
  if (server.status?.hostSSH?.phase !== 'Ready') return 'Waiting for verified management SSH access.'
  if (!selectOperatingSystem && (os.architecture !== 'amd64' || os.bootMode !== 'uefi' || ![['arch', 'rolling'], ['debian', 'trixie']].some(([distribution, version]) => os.distribution === distribution && os.version === version))) return 'Configure a supported amd64 UEFI target: Arch rolling or Debian trixie.'
  if ((!selectOperatingSystem && !server.spec?.boot?.isoRef?.name) || !server.spec?.sshCertificateAuthorityRef?.name) return 'Configure the boot ISO and SSH certificate authority first.'
  return ''
}

export function diskDeviceID(disk) {
  if (disk.wwn) return `wwn:${disk.wwn.toLowerCase()}`
  return disk.serial ? `serial:${disk.serial}` : ''
}

export function provisionDisks(machine) {
  const disks = machine.status?.inventory?.storage || []
  return disks.map(disk => {
    const id = diskDeviceID(disk)
    const eligible = disk.type === 'disk' && ['sata', 'ata', 'nvme'].includes(disk.tran) && id && disks.filter(other => diskDeviceID(other) === id).length === 1
    return { ...disk, deviceID: id, eligible: Boolean(eligible) }
  })
}

export function provisioningTargets(isos) {
  return isos.filter(iso => !iso.metadata.deletionTimestamp && iso.status?.phase === 'Ready'
    && iso.status.observedGeneration === iso.metadata.generation && iso.status.completedBuild?.id
    && iso.spec.architecture === 'amd64' && iso.spec.bootMode === 'uefi'
    && [['arch', 'rolling'], ['debian', 'trixie']].some(([distribution, version]) => iso.spec.distribution === distribution && iso.spec.version === version))
    .map(iso => ({ distribution: iso.spec.distribution, version: iso.spec.version, architecture: iso.spec.architecture, bootMode: iso.spec.bootMode,
      isoRef: { name: iso.metadata.name, uid: iso.metadata.uid } }))
}

export async function requestServerProvision(apiFetch, resourcePath, server, machine, deviceID, confirmation, runName, selection) {
  const blocked = provisionBlockReason(server, { selectOperatingSystem: Boolean(selection) })
  if (blocked) throw new Error(blocked)
  if (confirmation !== server.metadata.name) throw new Error('Type the exact Server name to confirm disk replacement.')
  const reference = server.status.machineRef
  if (machine.metadata.name !== reference.name || machine.metadata.uid !== reference.uid || machine.metadata.deletionTimestamp) throw new Error('The bound Machine changed. Refresh and select the disk again.')
  if (!provisionDisks(machine).some(disk => disk.eligible && disk.deviceID === deviceID)) throw new Error('Select one uniquely identified SATA/NVMe system disk.')
  if (selection) {
    const serverUID = server.metadata.uid
    const { target, targets } = selection
    const fields = ['distribution', 'version', 'architecture', 'bootMode']
    if (!target || !targets?.some(candidate => fields.every(field => candidate[field] === target[field]) && candidate.isoRef.uid === target.isoRef?.uid && candidate.isoRef.name === target.isoRef?.name)) throw new Error('Select an OS/version with an available supported ISO.')
    if (fields.some(field => server.spec.operatingSystem?.[field] !== target[field]) || server.spec.boot?.isoRef?.name !== target.isoRef.name || server.spec.boot?.isoRef?.uid !== target.isoRef.uid) {
      if (!server.metadata.resourceVersion) throw new Error('Refresh to obtain the current Server resource version.')
      const updated = await apiFetch(`${resourcePath}/${encodeURIComponent(server.metadata.name)}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/merge-patch+json', 'If-Match': `"${server.metadata.resourceVersion}"` },
        body: JSON.stringify({ operatingSystem: Object.fromEntries(fields.map(field => [field, target[field]])), boot: { isoRef: target.isoRef } }),
      })
      server = updated.body
      if (server.metadata.uid !== serverUID || server.status?.machineRef?.uid !== reference.uid || server.status?.machineRef?.name !== reference.name || server.spec.boot?.isoRef?.uid !== target.isoRef.uid || fields.some(field => server.spec.operatingSystem?.[field] !== target[field]) || provisionBlockReason(server, { selectOperatingSystem: true })) throw new Error('OS saved, but the Server changed. Refresh and review before requesting provisioning.')
    }
  }
  const name = runName || `provision-${crypto.randomUUID()}`
  try {
    return await apiFetch(resourcePath.replace(/\/servers$/, '/provisioning-runs'), {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ apiVersion: 'homelab.io/v1alpha1', kind: 'ProvisioningRun', metadata: { name }, spec: {
        serverRef: { name: server.metadata.name, uid: server.metadata.uid },
        serverGeneration: server.metadata.generation,
        machineRef: reference, storage: { disks: [{ deviceID, role: 'system' }] },
      } }),
    })
  } catch (error) {
    if (selection) error.message = `No provisioning request was confirmed; the selected OS may already be saved. Refresh and review before trying again. ${error.message}`
    throw error
  }
}
