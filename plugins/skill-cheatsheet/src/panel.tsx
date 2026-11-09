// No build step: Orca strips the types and compiles the JSX when the panel loads.
// The panel only draws; src/worker.ts reads ~/.claude.
import {
  atom,
  Badge,
  Button,
  Code,
  EmptyState,
  Heading,
  Input,
  plugin,
  read,
  Row,
  set,
  Spinner,
  Stack,
  Text,
  type PanelContext
} from 'orca'
import type { CheatSheetResult, SkillEntry } from './protocol'
import { filterSkills } from './skills'

const result = atom<CheatSheetResult | null>(null)
const query = atom('skill-cheatsheet.query', '')

let loadSeq = 0

async function load(): Promise<void> {
  const seq = ++loadSeq
  let next: CheatSheetResult
  try {
    next = await plugin.request('skills.load', {})
  } catch (error) {
    next = { kind: 'error', message: error instanceof Error ? error.message : String(error) }
  }
  if (seq === loadSeq) set(result, next)
}

export function setup(_ctx: PanelContext): void {
  loadSeq = 0
  set(result, null)
  void load()
}

function Group({ title, note, skills }: { title: string; note: string; skills: SkillEntry[] }) {
  if (skills.length === 0) return null
  return (
    <Stack gap="xs">
      <Heading level={3}>{title}</Heading>
      <Text size="xs" muted>
        {note}
      </Text>
      {skills.map((skill) => (
        <Stack gap="none">
          <Row justify="between" gap="sm">
            <Code>{skill.command}</Code>
            {skill.source === 'personal' ? null : <Badge>{skill.source}</Badge>}
          </Row>
          <Text size="xs" muted>
            {skill.summary || 'No SKILL.md on disk (bundled with Claude Code).'}
          </Text>
        </Stack>
      ))}
    </Stack>
  )
}

export default function Panel() {
  const current = read(result)
  if (current === null) return <Spinner label="Reading skills" />
  if (current.kind === 'error') {
    return (
      <EmptyState title="Could not read ~/.claude" description={current.message} icon="alert">
        <Button onPress={load}>Retry</Button>
      </EmptyState>
    )
  }
  const shown = filterSkills(current.skills, read(query))
  const manual = shown.filter((s) => s.mode === 'manual')
  const nameOnly = shown.filter((s) => s.mode === 'name-only')
  return (
    <Stack gap="md">
      <Row gap="sm">
        <Input
          label="Filter skills"
          labelHidden
          type="search"
          placeholder="Filter by name or what it does…"
          value={read(query)}
          onChange={(value) => set(query, value)}
        />
        <Button variant="ghost" onPress={load}>
          Reload
        </Button>
      </Row>
      {current.skills.length === 0 ? (
        <EmptyState
          title="No hidden skills"
          description="Every skill is listed to the model, so it can pick them on its own."
          icon="book"
        />
      ) : shown.length === 0 ? (
        <EmptyState title="No skill matches" icon="search" />
      ) : (
        <Stack gap="md">
          <Group title="Invoke by hand" note="Hidden from the model: type the command yourself." skills={manual} />
          <Group
            title="Listed by name only"
            note="The model sees the name without the description; invoke it when you need it."
            skills={nameOnly}
          />
        </Stack>
      )}
    </Stack>
  )
}
