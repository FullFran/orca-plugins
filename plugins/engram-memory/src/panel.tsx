// No build step: Orca strips the types and compiles the JSX when the panel loads.
// The panel only draws; src/worker.ts finds the workspace folder and reads Engram.
import {
  atom,
  Badge,
  Button,
  Code,
  EmptyState,
  Heading,
  host,
  IconButton,
  Input,
  List,
  ListItem,
  on,
  plugin,
  read,
  Row,
  Separator,
  set,
  Spinner,
  Stack,
  Text,
  type PanelContext
} from 'orca'
import type { Memory, MemoriesResult, MemoryResult, WorkspaceContext } from './protocol'

const MAX_DETAIL_LINES = 400

/** The focused workspace; undefined until Orca has told us. */
const workspace = atom<WorkspaceContext | null | undefined>(undefined)
const result = atom<MemoriesResult | null>(null)
const loading = atom(false)
const query = atom('')
/** The folder picked for an ambiguous workspace, remembered per Orca workspace. */
const choice = atom<string | null>('choice', null, { persist: 'workspace' })
/** The memory open in the detail view. */
const detail = atom<{ id: number; result: MemoryResult | null } | null>(null)

let loadSeq = 0
let workspaceKey: string | null = null

async function load(): Promise<void> {
  const context = read(workspace)
  if (context === undefined) return
  const seq = ++loadSeq
  set(loading, true)
  let next: MemoriesResult
  try {
    next = await plugin.request('memories.load', {
      context,
      query: read(query),
      choice: read(choice)
    })
  } catch (error) {
    next = { kind: 'error', message: error instanceof Error ? error.message : String(error) }
  }
  if (seq !== loadSeq) return // A newer load is on its way.
  set(result, next)
  set(loading, false)
}

async function openMemory(id: number): Promise<void> {
  set(detail, { id, result: null })
  let answer: MemoryResult
  try {
    answer = await plugin.request('memory.get', { id })
  } catch (error) {
    answer = { kind: 'error', message: error instanceof Error ? error.message : String(error) }
  }
  if (read(detail)?.id === id) set(detail, { id, result: answer })
}

function focus(context: WorkspaceContext | null): void {
  const key = JSON.stringify(context && [context.branch, context.displayName, context.terminals])
  if (key === workspaceKey) return
  workspaceKey = key
  set(workspace, context)
  set(detail, null)
  void load()
}

export function setup(ctx: PanelContext): void {
  loadSeq = 0
  workspaceKey = null
  ctx.subscriptions.push(on('workspace.changed', ({ context }) => focus(context)))
  void host.call('workspace.readContext', {}).then(focus, () => focus(null))
}

/** Engram writes UTC times as `2026-11-01 10:05:00`; show them to the minute. */
const shortDate = (value: string) => (value ? `${value.slice(0, 16).replace('T', ' ')} UTC` : '')

function StateBadges({ memory }: { memory: Memory }) {
  return (
    <Row gap="xs" wrap>
      {memory.state === 'needs_review' ? <Badge tone="warning">Needs review</Badge> : null}
      {memory.superseded ? <Badge tone="neutral">Superseded</Badge> : null}
    </Row>
  )
}

function MemoryList({ memories, searched }: { memories: Memory[]; searched: string }) {
  if (memories.length === 0) {
    return searched ? (
      <EmptyState title="No memory matches" description={`Nothing for “${searched}”.`} icon="search" />
    ) : (
      <EmptyState
        title="No memories yet"
        description="Engram has nothing saved for this project."
        icon="lightbulb"
      />
    )
  }
  return (
    <List label={searched ? 'Search results' : 'Recent memories'}>
      {memories.map((memory) => (
        <ListItem key={String(memory.id)} title={memory.title} onPress={() => openMemory(memory.id)}>
          <Stack gap="xs">
            <Row gap="xs" wrap>
              <Text size="xs" muted>
                {`${memory.type} · ${shortDate(memory.updatedAt)}`}
              </Text>
              <StateBadges memory={memory} />
            </Row>
            {memory.preview ? (
              <Text size="xs" truncate>
                {memory.preview}
              </Text>
            ) : null}
          </Stack>
        </ListItem>
      ))}
    </List>
  )
}

function MemoryDetail({ id, answer }: { id: number; answer: MemoryResult | null }) {
  const back = (
    <Row>
      <Button variant="ghost" onPress={() => set(detail, null)}>
        Back
      </Button>
    </Row>
  )
  if (!answer) {
    return (
      <Stack gap="md">
        {back}
        <Spinner label={`Loading memory ${id}`} />
      </Stack>
    )
  }
  if (answer.kind !== 'ok') {
    const description =
      answer.kind === 'not-found' ? `Engram has no memory ${answer.id}.` : answer.message
    return (
      <Stack gap="md">
        {back}
        <EmptyState title="Cannot show this memory" description={description} icon="warning">
          <Button onPress={() => openMemory(id)}>Retry</Button>
        </EmptyState>
      </Stack>
    )
  }
  const memory = answer.memory
  const lines = (memory.content ?? '').split('\n')
  const shown = lines.slice(0, MAX_DETAIL_LINES)
  return (
    <Stack gap="md">
      {back}
      <Stack gap="xs">
        <Heading level={2}>{memory.title}</Heading>
        <Row gap="xs" wrap>
          <Badge tone="accent">{memory.type}</Badge>
          {memory.scope ? <Badge>{memory.scope}</Badge> : null}
          <StateBadges memory={memory} />
        </Row>
        <Text size="xs" muted>
          {`Updated ${shortDate(memory.updatedAt)} · created ${shortDate(memory.createdAt)} · #${memory.id}`}
        </Text>
        {memory.topicKey ? <Code>{memory.topicKey}</Code> : null}
        {memory.state === 'needs_review' ? (
          <Text size="xs" tone="warning">
            Engram marks this memory as stale: check it against the code before relying on it.
          </Text>
        ) : null}
      </Stack>
      <Separator />
      <Stack gap="xs">
        {shown.map((line, index) =>
          line.trim() ? (
            <Text key={String(index)} size="sm">
              {line}
            </Text>
          ) : null
        )}
        {lines.length > shown.length ? (
          <Text size="xs" muted>
            {`${lines.length - shown.length} more lines not shown.`}
          </Text>
        ) : null}
      </Stack>
    </Stack>
  )
}

function Problem({ state }: { state: MemoriesResult }) {
  switch (state.kind) {
    case 'no-workspace':
      return (
        <EmptyState
          title="No workspace focused"
          description="Focus a workspace to see its Engram memories."
          icon="folder"
        />
      )
    case 'workspace-none':
      return (
        <EmptyState
          title="Workspace folder not found"
          description={`No Orca worktree has branch ${state.branch} and name ${state.displayName}.`}
          icon="folder"
        >
          <Button onPress={load}>Retry</Button>
        </EmptyState>
      )
    case 'workspace-ambiguous':
      return (
        <Stack gap="sm">
          <EmptyState
            title="Several workspaces match"
            description="More than one worktree has this branch and name. Pick the folder of this workspace."
            icon="folder"
          />
          <List label="Matching folders">
            {state.candidates.map((candidate) => (
              <ListItem
                key={candidate.path}
                title={candidate.path}
                description={candidate.branch}
                icon="folder"
                onPress={() => {
                  set(choice, candidate.path)
                  void load()
                }}
              />
            ))}
          </List>
        </Stack>
      )
    case 'project-ambiguous':
      return (
        <EmptyState
          title="Engram cannot tell the project"
          description={`${state.path} could be any of: ${state.availableProjects.join(', ')}. ${state.hint}`.trim()}
          icon="warning"
        />
      )
    case 'project-none':
      return (
        <EmptyState
          title="No Engram project for this folder"
          description={`${state.path}. ${state.hint}`.trim()}
          icon="info"
        />
      )
    case 'engram-down':
      return (
        <EmptyState title="Engram is not reachable" description={state.message} icon="error">
          <Button onPress={load}>Retry</Button>
        </EmptyState>
      )
    case 'error':
      return (
        <EmptyState title="Something went wrong" description={state.message} icon="error">
          <Button onPress={load}>Retry</Button>
        </EmptyState>
      )
    default:
      return null
  }
}

export default function Panel() {
  const open = read(detail)
  if (open) return <MemoryDetail id={open.id} answer={open.result} />

  const state = read(result)
  const busy = read(loading)
  if (!state) return <Spinner label="Loading memories" />
  if (state.kind !== 'ok') return <Problem state={state} />

  return (
    <Stack gap="md">
      <Row justify="between" align="center">
        <Stack gap="none">
          <Heading level={2}>{state.project}</Heading>
          <Text size="xs" muted truncate>
            {state.path}
          </Text>
        </Stack>
        <IconButton icon="refresh" label="Refresh" variant="ghost" disabled={busy} onPress={load} />
      </Row>
      <Input
        label="Search memories"
        labelHidden
        type="search"
        placeholder="Search this project's memories…"
        value={read(query)}
        onChange={(value) => {
          set(query, value)
          if (value === '' && state.query !== '') void load()
        }}
        onSubmit={(value) => {
          set(query, value)
          void load()
        }}
      />
      {busy ? <Spinner label="Loading memories" /> : null}
      <MemoryList memories={state.memories} searched={state.query} />
    </Stack>
  )
}
