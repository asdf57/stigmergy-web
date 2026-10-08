import { useEffect, useState } from 'react'
import { Badge, Box, Tooltip } from '@mantine/core'
import { agentPulse } from './serverOperations.js'
import { acceptProvisioningUpdate } from './serverProvisioningProgress.js'

export default function ServerAgentPulse({ item, resourcePath, apiFetch }) {
  const [server, setServer] = useState(item)
  const [now, setNow] = useState(Date.now())
  const [error, setError] = useState('')
  useEffect(() => { setServer(previous => previous.metadata.uid !== item.metadata.uid || acceptProvisioningUpdate(previous, item) ? item : previous) }, [item])
  useEffect(() => {
    let active = true
    let fetching = false
    const poll = async () => {
      if (!active) return
      setNow(Date.now())
      if (document.hidden || fetching) return
      fetching = true
      try {
        const { body } = await apiFetch(`${resourcePath}/${encodeURIComponent(item.metadata.name)}`)
        if (!active) return
        if (body.metadata.uid !== item.metadata.uid) { setError('Server identity changed; refresh.'); return }
        setServer(previous => acceptProvisioningUpdate(previous, body) ? body : previous)
        setError('')
      } catch (caught) { if (active) setError(caught.message) } finally { fetching = false }
    }
    const timer = setInterval(poll, 10000)
    return () => { active = false; clearInterval(timer) }
  }, [item.metadata.name, item.metadata.uid, resourcePath, apiFetch])
  const pulse = agentPulse(server, now)
  return <Tooltip label={error ? `Unable to refresh reports: ${error}` : pulse.description}>
    <Badge variant="light" color={error ? 'gray' : pulse.color} leftSection={<Box className={pulse.reporting && !error ? 'agent-pulse-dot reporting' : 'agent-pulse-dot'} />} aria-label={`homelabd: ${error ? 'Unknown' : pulse.label}`}>
      {error ? 'Unknown' : pulse.label}
    </Badge>
  </Tooltip>
}
