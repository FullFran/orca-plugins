// `orca plugin test .` runs this in Node with the same runtime and checks Orca uses.
import { assert, test } from 'orca/testing'
import { buildCheatSheet, filterSkills, findSkills, mergeOverrides, parseFrontmatter, summarize, type Fs } from './skills'

const skillMd = (name: string, description: string, extra = '') =>
  `---\nname: ${name}\ndescription: ${description}\n${extra}---\n\n# Body\n`

function fakeFs(files: Record<string, string>): Fs {
  return {
    readFile: async (path) => files[path] ?? null,
    listDirs: async (path) => {
      const prefix = `${path}/`
      const dirs = new Set<string>()
      for (const file of Object.keys(files)) {
        if (file.startsWith(prefix)) {
          const rest = file.slice(prefix.length).split('/')
          if (rest.length > 1) dirs.add(rest[0])
        }
      }
      return [...dirs]
    }
  }
}

test('parses single-line, folded and quoted frontmatter', () => {
  assert.deepEqual(parseFrontmatter(skillMd('a', 'Does a thing.', 'disable-model-invocation: true\n')), {
    name: 'a',
    description: 'Does a thing.',
    disableModelInvocation: true
  })
  const folded = parseFrontmatter('---\nname: "b"\ndescription: >-\n  First line\n  second line.\n---\n')
  assert.equal(folded.name, 'b')
  assert.equal(folded.description, 'First line second line.')
  assert.equal(folded.disableModelInvocation, false)
  assert.deepEqual(parseFrontmatter('no frontmatter'), { name: null, description: '', disableModelInvocation: false })
})

test('summary drops the trigger sentence and keeps what it does', () => {
  assert.equal(
    summarize('Trigger: diapositivas fran, slides. Build a fullfran-style deck and render it. More text.'),
    'Build a fullfran-style deck and render it.'
  )
  assert.equal(summarize('Clerk authentication router. Use when...'), 'Clerk authentication router.')
  assert.equal(
    summarize('Trigger: a post for www.fullfran.com (blog/*.md). Write narrative posts.'),
    'Write narrative posts.'
  )
  assert.equal(summarize(''), '')
  const long = summarize(`${'x'.repeat(200)}.`)
  assert.equal(long.length, 120)
  assert.ok(long.endsWith('…'))
})

test('later settings files override earlier ones; broken files are ignored', () => {
  assert.deepEqual(
    mergeOverrides([
      JSON.stringify({ skillOverrides: { a: 'user-invocable-only', b: 'name-only' } }),
      '{ broken',
      null,
      JSON.stringify({ skillOverrides: { b: 'on' } })
    ]),
    { a: 'user-invocable-only', b: 'on' }
  )
})

test('builds the cheat sheet from overrides, frontmatter and plugin skills', async () => {
  const fs = fakeFs({
    '/c/skills/slides/SKILL.md': skillMd('slides', 'Trigger: slides. Build a deck.'),
    '/c/skills/blog/SKILL.md': skillMd('blog', 'Write a blog post.', 'disable-model-invocation: true\n'),
    '/c/skills/listed/SKILL.md': skillMd('listed', 'Always listed.'),
    '/c/skills/synced/x/docx/SKILL.md': skillMd('docx', 'Synced, ignored.'),
    '/c/plugins/cache/m/codex/1.0.0/skills/rescue/SKILL.md': skillMd('rescue', 'Old version.', 'disable-model-invocation: true\n'),
    '/c/plugins/cache/m/codex/1.1.0/skills/rescue/SKILL.md': skillMd('rescue', 'Hand work to Codex.', 'disable-model-invocation: true\n'),
    '/c/plugins/cache/m/codex/1.1.0/skills/runtime/SKILL.md': skillMd('runtime', 'Internal helper.')
  })
  const skills = await findSkills(fs, '/c')
  const sheet = buildCheatSheet(skills, { slides: 'user-invocable-only', dataviz: 'name-only', listed: 'on', ghost: 'off' })
  assert.deepEqual(sheet, [
    { command: '/blog', mode: 'manual', summary: 'Write a blog post.', source: 'personal' },
    { command: '/codex:rescue', mode: 'manual', summary: 'Hand work to Codex.', source: 'codex' },
    { command: '/slides', mode: 'manual', summary: 'Build a deck.', source: 'personal' },
    { command: '/dataviz', mode: 'name-only', summary: '', source: 'not found' }
  ])
})

test('filters by command, summary or source', () => {
  const sheet = [
    { command: '/slides', mode: 'manual' as const, summary: 'Build a deck.', source: 'personal' },
    { command: '/codex:rescue', mode: 'manual' as const, summary: 'Hand work over.', source: 'codex' }
  ]
  assert.deepEqual(filterSkills(sheet, 'DECK').map((s) => s.command), ['/slides'])
  assert.deepEqual(filterSkills(sheet, 'codex').map((s) => s.command), ['/codex:rescue'])
  assert.equal(filterSkills(sheet, '  ').length, 2)
})
