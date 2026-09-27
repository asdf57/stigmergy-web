import Editor, { loader } from '@monaco-editor/react'
import * as monaco from 'monaco-editor/editor/editor.api.js'
import EditorWorker from 'monaco-editor/editor/editor.worker.js?worker'
import 'monaco-editor/editor/contrib/bracketMatching/browser/bracketMatching.js'
import 'monaco-editor/editor/contrib/clipboard/browser/clipboard.js'
import 'monaco-editor/editor/contrib/comment/browser/comment.js'
import 'monaco-editor/editor/contrib/find/browser/findController.js'
import 'monaco-editor/editor/contrib/folding/browser/folding.js'
import 'monaco-editor/editor/contrib/linesOperations/browser/linesOperations.js'
import 'monaco-editor/editor/contrib/multicursor/browser/multicursor.js'
import 'monaco-editor/languages/definitions/shell/register.js'
import { ActionIcon, Badge, Box, Group, Modal, Text, Tooltip, useComputedColorScheme } from '@mantine/core'
import { useDisclosure } from '@mantine/hooks'
import { Maximize2 } from 'lucide-react'

loader.config({ monaco })
self.MonacoEnvironment = { getWorker: () => new EditorWorker() }

export default function ShellScriptWidget({ id, label, required, value = '', onChange, disabled, readonly, rawErrors = [] }) {
  const scheme = useComputedColorScheme('light')
  const [fullscreen, { open, close }] = useDisclosure(false)
  const options = {
    automaticLayout: true,
    folding: true,
    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
    fontSize: 14,
    insertSpaces: true,
    lineNumbersMinChars: 3,
    minimap: { enabled: true },
    padding: { top: 14, bottom: 14 },
    readOnly: disabled || readonly,
    renderWhitespace: 'selection',
    scrollBeyondLastLine: false,
    tabSize: 2,
    wordWrap: 'on',
  }
  const editor = (height) => <Editor height={height} language="shell" theme={scheme === 'dark' ? 'vs-dark' : 'light'} value={value || ''} onChange={(next) => onChange(next ?? '')} options={options} />

  return <Box id={id} className="script-editor-field">
    <Group justify="space-between" mb={6} wrap="nowrap"><Group gap="xs"><Text size="sm" fw={500}>{label}{required && <Text component="span" c="red"> *</Text>}</Text><Badge size="xs" variant="light" color="gray">Shell</Badge></Group><Tooltip label="Edit fullscreen"><ActionIcon variant="subtle" color="gray" onClick={open} aria-label="Edit script fullscreen"><Maximize2 size={16} /></ActionIcon></Tooltip></Group>
    <Box className="script-editor-frame">{editor(460)}</Box>
    {rawErrors.length > 0 && <Text c="red" size="xs" mt={5}>{rawErrors.join(' · ')}</Text>}
    <Modal opened={fullscreen} onClose={close} title={<Group gap="xs"><Text fw={700}>{label}</Text><Badge size="xs" variant="light" color="gray">Shell</Badge></Group>} fullScreen styles={{ body: { height: 'calc(100vh - 61px)', padding: 0 } }}>{editor('100%')}</Modal>
  </Box>
}
