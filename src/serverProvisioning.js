export function serverProvisioningPhase(server) {
  const status = server.status?.provisioning || {}
  if (status.activeRunRef) return 'Provisioning'
  if (status.maintenance) return 'Blocked'
  return status.provisioned ? 'Provisioned' : server.status?.phase || 'Awaiting installation'
}

export function provisionBlockReason(server) {
  const status = server.status?.provisioning || {}
  const os = server.spec?.operatingSystem || {}
  if (server.metadata?.deletionTimestamp) return 'This Server is being deleted.'
  if (status.maintenance || status.activeRunRef) return 'A run owns this Server. Finish or inspect recovery before requesting another.'
  if (!server.spec?.provisioning?.enabled) return 'Enable provisioning in the Server configuration first; enabling it does not erase disks.'
  if (server.spec?.reconciliation?.paused) return 'Server reconciliation is paused.'
  if (!server.status?.machineRef?.uid) return 'Waiting for a discovered Machine binding.'
  if (!Number.isSafeInteger(server.metadata?.generation) || server.metadata.generation < 1) return 'Refresh to obtain the current Server generation.'
  if (server.status?.hostSSH?.phase !== 'Ready') return 'Waiting for verified management SSH access.'
  if (os.architecture !== 'amd64' || os.bootMode !== 'uefi' || ![['arch', 'rolling'], ['debian', 'trixie']].some(([distribution, version]) => os.distribution === distribution && os.version === version)) return 'Configure a supported amd64 UEFI target: Arch rolling or Debian trixie.'
  if (!server.spec?.boot?.isoRef?.name || !server.spec?.sshCertificateAuthorityRef?.name) return 'Configure the boot ISO and SSH certificate authority first.'
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

export async function requestServerProvision(apiFetch, resourcePath, server, machine, deviceID, confirmation, runName) {
  const blocked = provisionBlockReason(server)
  if (blocked) throw new Error(blocked)
  if (confirmation !== server.metadata.name) throw new Error('Type the exact Server name to confirm disk replacement.')
  const reference = server.status.machineRef
  if (machine.metadata.name !== reference.name || machine.metadata.uid !== reference.uid || machine.metadata.deletionTimestamp) throw new Error('The bound Machine changed. Refresh and select the disk again.')
  if (!provisionDisks(machine).some(disk => disk.eligible && disk.deviceID === deviceID)) throw new Error('Select one uniquely identified SATA/NVMe system disk.')
  const name = runName || `provision-${crypto.randomUUID()}`
  return apiFetch(resourcePath.replace(/\/servers$/, '/provisioning-runs'), {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ apiVersion: 'homelab.io/v1alpha1', kind: 'ProvisioningRun', metadata: { name }, spec: {
      serverRef: { name: server.metadata.name, uid: server.metadata.uid },
      serverGeneration: server.metadata.generation,
      machineRef: reference, storage: { disks: [{ deviceID, role: 'system' }] },
    } }),
  })
}
