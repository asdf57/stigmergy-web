export async function deleteBlockedProvision(apiFetch, resourcePath, server, run) {
  const ref = server.status?.provisioning?.activeRunRef
  if (run?.status?.phase !== 'Blocked' || !ref || ref.name !== run.metadata.name || ref.uid !== run.metadata.uid) {
    throw new Error('Refresh: this is no longer the Server’s blocked request.')
  }
  const path = `${resourcePath.replace(/\/servers$/, '/provisioning-runs')}/${encodeURIComponent(ref.name)}`
  const latest = await apiFetch(path)
  if (latest.body.metadata.uid !== ref.uid || latest.body.status?.phase !== 'Blocked') {
    throw new Error('The request changed. Refresh before deleting.')
  }
  await apiFetch(path, { method: 'DELETE', headers: { 'If-Match': `"${latest.body.metadata.resourceVersion}"` } })
  return apiFetch(`${resourcePath}/${encodeURIComponent(server.metadata.name)}`)
}
