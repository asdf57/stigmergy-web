export const provisioningSteps = [
  ['Queued', 'Queued', 'Waiting for the operator to claim the request.'],
  ['PreparingBoot', 'Preparing boot', 'Checking identities, reserving maintenance and preparing the boot path.'],
  ['AwaitingLive', 'Awaiting live ISO', 'Waiting for the pinned live image and verified SSH identity.'],
  ['Installing', 'Installing', 'Installing the requested OS on the approved disk.'],
  ['AwaitingInstalled', 'Awaiting installed OS', 'Waiting for the final installed-system boot.'],
  ['Verifying', 'Verifying', 'Checking the installation marker, disk, SSH identity and services.'],
  ['Succeeded', 'Succeeded', 'Installed-system verification completed.'],
]

export function provisioningProgress(run) {
  const status = run?.status || {}
  const phase = status.phase === 'Pending' ? 'Queued' : status.phase || 'Not requested'
  const index = provisioningSteps.findIndex(([key]) => key === phase)
  return {
    phase,
    request: run?.metadata?.name || 'No run',
    message: status.message || '',
    buildID: status.backendRunID,
    attemptID: status.attemptID,
    maintenance: Boolean(status.maintenance),
    startedAt: status.startedAt,
    completedAt: status.completedAt,
    steps: provisioningSteps.map(([key, label, description], position) => ({
      key, label, description,
      state: index < 0 ? 'unconfirmed' : position === index ? 'current' : position < index ? 'earlier' : 'pending',
    })),
  }
}

export function acceptProvisioningUpdate(current, incoming) {
  if (current.metadata?.uid !== incoming.metadata?.uid) return false
  const oldVersion = String(current.metadata?.resourceVersion || '')
  const newVersion = String(incoming.metadata?.resourceVersion || '')
  if (!/^\d+$/.test(oldVersion) || !/^\d+$/.test(newVersion)) return false
  return BigInt(newVersion) >= BigInt(oldVersion)
}
