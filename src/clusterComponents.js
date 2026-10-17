const maximumVerificationAge = 15 * 60 * 1000

/** Follow declared dependency names without guessing from executable/script contents. */
function dependsOnSetup(configuration, configurationsByName, setupNames) {
  const pending = (configuration.spec?.dependsOn || []).map(reference => reference.name)
  const visited = new Set()
  while (pending.length) {
    const name = pending.pop()
    if (setupNames.has(name)) return true
    if (visited.has(name)) continue
    visited.add(name)
    pending.push(...(configurationsByName.get(name)?.spec?.dependsOn || []).map(reference => reference.name))
  }
  return false
}

/** A component is explicitly cluster-associated and requests its context or follows its setup. */
export function clusterComponents(cluster, configurations) {
  const candidates = configurations.filter(configuration => configuration.kind === 'Configuration')
  const configurationsByName = new Map(candidates.map(configuration => [configuration.metadata.name, configuration]))
  const setupNames = new Set([cluster.status?.configurationRef?.name,
    cluster.status?.observation?.configurationRef?.name].filter(Boolean))
  return candidates.filter(configuration => {
    if (setupNames.has(configuration.metadata.name)) return false
    const target = configuration.spec?.targetRef
    const requestsContext = configuration.spec?.context?.kubeClusterRef?.name === cluster.metadata.name
    const targetsCluster = target?.kind === 'KubeCluster' && target.name === cluster.metadata.name
    return requestsContext || (targetsCluster && dependsOnSetup(configuration, configurationsByName, setupNames))
  }).sort((first, second) => first.metadata.name.localeCompare(second.metadata.name))
}

function resolvedResourceMatches(configuration, resource) {
  return configuration.status?.resolvedReferences?.some(reference => reference.kind === resource.kind
    && reference.name === resource.metadata.name && reference.uid === resource.metadata.uid
    && reference.generation === resource.metadata.generation)
}

/** Report reconciliation observations, not inferred Helm release or live workload health. */
export function componentStatus(configuration, cluster, configurations, now = Date.now()) {
  const status = configuration.status || {}
  if (configuration.metadata.deletionTimestamp) return { label: 'Deleting', color: 'orange' }
  if (configuration.spec?.suspended || status.phase === 'Suspended') return { label: 'Suspended', color: 'gray' }
  if (status.observedGeneration !== undefined && status.observedGeneration !== configuration.metadata.generation) {
    return { label: 'Changes pending', color: 'yellow' }
  }
  if (status.phase === 'Failed') return { label: 'Failed', color: 'red' }
  if (status.phase === 'Reconciling') return { label: 'Reconciling', color: 'blue' }
  if (status.phase === 'Pending') return { label: status.reason === 'DependencyPending' ? 'Waiting for dependencies' : 'Pending', color: 'yellow' }
  if (status.phase !== 'Ready' || status.observedGeneration === undefined) return { label: 'Not reported', color: 'gray' }
  const dependenciesMatch = (configuration.spec?.dependsOn || []).every(reference => {
    const dependency = configurations.find(candidate => candidate.kind === 'Configuration' && candidate.metadata.name === reference.name)
    return dependency && !dependency.metadata.deletionTimestamp && resolvedResourceMatches(configuration, dependency)
  })
  if (!resolvedResourceMatches(configuration, cluster) || !dependenciesMatch) {
    return { label: 'Needs reconciliation', color: 'yellow' }
  }
  const timestamp = Date.parse(status.lastVerifiedAt)
  if (!Number.isFinite(timestamp) || timestamp > now + 5000) return { label: 'Not verified', color: 'gray' }
  if (now - timestamp > maximumVerificationAge) return { label: 'Verification stale', color: 'yellow' }
  return { label: 'Ready', color: 'green' }
}
