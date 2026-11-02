import { atom, Code, EmptyState, Heading, Input, Row, Stack, Text, read, set } from 'orca'
import { filterGroups, SHORTCUT_GROUPS } from './shortcuts'

const query = atom('fran-shortcuts.query', '')

export default function Panel() {
  const groups = filterGroups(SHORTCUT_GROUPS, read(query))
  return (
    <Stack gap="md">
      <Input
        label="Filter shortcuts"
        labelHidden
        type="search"
        placeholder="Filter by action or key…"
        value={read(query)}
        onChange={(value) => set(query, value)}
      />
      {groups.length === 0 ? (
        <EmptyState title="No shortcut matches" icon="search" />
      ) : (
        groups.map((group) => (
          <Stack gap="xs">
            <Heading level={3}>{group.title}</Heading>
            <Stack gap="xs">
              {group.items.map((item) => (
                <Row justify="between" gap="sm">
                  <Stack gap="none">
                    <Text size="sm">{item.action}</Text>
                    {item.note ? (
                      <Text size="xs" muted>
                        {item.note}
                      </Text>
                    ) : null}
                  </Stack>
                  <Code>{item.keys}</Code>
                </Row>
              ))}
            </Stack>
          </Stack>
        ))
      )}
    </Stack>
  )
}
