/** Read the target and its exact active Operation; never infer ownership from age. */
export async function readActiveOperation(apiFetch, resourcePath, target, signal) {
  const { body: latest } = await apiFetch(`${resourcePath}/${encodeURIComponent(target.metadata.name)}`, { signal })
  if (latest.metadata.uid !== target.metadata.uid) throw new Error('The target was replaced. Refresh this page.')
  if (target.kind === 'Operation') return latest
  const reference = latest.status?.operationRef
  if (!reference) return null
  const base = resourcePath.slice(0, resourcePath.lastIndexOf('/'))
  const { body: operation } = await apiFetch(`${base}/operations/${encodeURIComponent(reference.name)}`, { signal })
  const owner = operation.spec?.targetRef
  if (operation.metadata.uid !== reference.uid || owner?.kind !== target.kind || owner?.name !== target.metadata.name || owner?.uid !== target.metadata.uid) throw new Error('Operation identity does not match this target. Refresh this page.')
  return operation
}
