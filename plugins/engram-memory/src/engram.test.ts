import { assert, test } from 'orca/testing'
import { createEngramClient, EngramUnavailable, parseMemory, type FetchLike } from './engram'

const NOW = Date.parse('2026-11-02T12:00:00Z')

/** A fetch that answers by path and records each URL it was asked for. */
function fakeFetch(routes: Record<string, { status?: number; body: unknown }>) {
  const urls: string[] = []
  const fetch: FetchLike = async (url, init) => {
    urls.push(String(url))
    assert.equal(init?.method ?? 'GET', 'GET', 'the client only reads')
    const u = new URL(String(url))
    const route = routes[u.pathname]
    if (!route) return new Response(JSON.stringify({ error: 'not found' }), { status: 404 })
    return new Response(JSON.stringify(route.body), { status: route.status ?? 200 })
  }
  return { fetch, urls }
}

const observation = {
  id: 1725,
  sync_id: 'obs-1',
  session_id: 's',
  type: 'preference',
  title: 'Captured trust-building contribution strategy need',
  content: '**What**: Learned the user wants\nto build trust.',
  project: 'engram',
  scope: 'project',
  topic_key: 'user-preferences/first',
  revision_count: 1,
  duplicate_count: 1,
  created_at: '2026-04-08 15:41:20',
  updated_at: '2026-04-09 10:00:00'
}

test('parses an observation into a memory', () => {
  const memory = parseMemory(observation, { withContent: true, now: NOW })
  assert.deepEqual(memory, {
    id: 1725,
    title: 'Captured trust-building contribution strategy need',
    type: 'preference',
    scope: 'project',
    topicKey: 'user-preferences/first',
    createdAt: '2026-04-08 15:41:20',
    updatedAt: '2026-04-09 10:00:00',
    preview: '**What**: Learned the user wants to build trust.',
    content: '**What**: Learned the user wants\nto build trust.',
    state: 'active',
    superseded: false
  })
})

test('a passed review_after marks the memory needs_review, a future one does not', () => {
  const stale = parseMemory({ ...observation, review_after: '2026-10-01 00:00:00' }, { now: NOW })
  assert.equal(stale?.state, 'needs_review')
  const fresh = parseMemory({ ...observation, review_after: '2027-01-01T00:00:00Z' }, { now: NOW })
  assert.equal(fresh?.state, 'active')
  const superseded = parseMemory({ ...observation, superseded_by_sync_id: 'obs-2' }, { now: NOW })
  assert.equal(superseded?.superseded, true)
})

test('the preview is one line and bounded; content stays out of list items', () => {
  const memory = parseMemory({ ...observation, content: 'x'.repeat(500) }, { now: NOW })
  assert.equal(memory?.content, null)
  assert.ok((memory?.preview.length ?? 0) <= 161)
})

test('rows without a numeric id are dropped', () => {
  assert.equal(parseMemory({ title: 'no id' }, { now: NOW }), null)
  assert.equal(parseMemory(null, { now: NOW }), null)
})

test('currentProject sends the folder as cwd and reads a unique project', async () => {
  const { fetch, urls } = fakeFetch({
    '/project/current': {
      body: {
        available_projects: null,
        cwd: '/repos/orca-plugins',
        project: 'orca-plugins',
        project_path: '/repos/orca-plugins',
        project_source: 'git_remote'
      }
    }
  })
  const client = createEngramClient({ baseUrl: 'http://127.0.0.1:7437', fetch })
  assert.deepEqual(await client.currentProject('/repos/orca-plugins'), {
    kind: 'unique',
    project: 'orca-plugins',
    source: 'git_remote'
  })
  assert.equal(urls[0], 'http://127.0.0.1:7437/project/current?cwd=%2Frepos%2Forca-plugins')
})

test('currentProject reports an ambiguous answer instead of picking a project', async () => {
  const { fetch } = fakeFetch({
    '/project/current': {
      body: {
        available_projects: ['dotfiles', 'orca-mvp-sandbox'],
        cwd: '/home/fran',
        error_hint: 'ambiguous project: multiple git repos found in cwd',
        project: '',
        project_path: '/home/fran',
        project_source: 'ambiguous'
      }
    }
  })
  const client = createEngramClient({ baseUrl: 'http://127.0.0.1:7437', fetch })
  assert.deepEqual(await client.currentProject('/home/fran'), {
    kind: 'ambiguous',
    availableProjects: ['dotfiles', 'orca-mvp-sandbox'],
    hint: 'ambiguous project: multiple git repos found in cwd'
  })
})

test('a non-empty available_projects is ambiguous even with a project name', async () => {
  const { fetch } = fakeFetch({
    '/project/current': {
      body: { available_projects: ['a', 'b'], project: 'a', project_source: 'dir_basename' }
    }
  })
  const client = createEngramClient({ baseUrl: 'http://x', fetch })
  const result = await client.currentProject('/r')
  assert.equal(result.kind, 'ambiguous')
})

test('recent asks for the named project and parses the list', async () => {
  const { fetch, urls } = fakeFetch({ '/observations/recent': { body: [observation] } })
  const client = createEngramClient({ baseUrl: 'http://x', fetch, now: () => NOW })
  const memories = await client.recent('engram', 30)
  assert.equal(memories.length, 1)
  assert.equal(memories[0].id, 1725)
  assert.equal(urls[0], 'http://x/observations/recent?project=engram&limit=30')
})

test('a project without memories yet reads as an empty list', async () => {
  const { fetch } = fakeFetch({
    '/observations/recent': {
      status: 404,
      body: { code: 'unknown_project', error: 'project "new" not found', available_projects: ['a'] }
    }
  })
  const client = createEngramClient({ baseUrl: 'http://x', fetch })
  assert.deepEqual(await client.recent('new', 30), [])
})

test('search sends q and project and parses ranked results', async () => {
  const { fetch, urls } = fakeFetch({ '/search': { body: [{ ...observation, rank: -3.2 }] } })
  const client = createEngramClient({ baseUrl: 'http://x', fetch, now: () => NOW })
  const memories = await client.search('engram', 'trust me', 20)
  assert.equal(memories[0].title, observation.title)
  assert.equal(urls[0], 'http://x/search?q=trust+me&project=engram&limit=20')
})

test('get returns the full memory, or null when Engram has no such id', async () => {
  const { fetch } = fakeFetch({ '/observations/1725': { body: observation } })
  const client = createEngramClient({ baseUrl: 'http://x', fetch, now: () => NOW })
  assert.equal((await client.get(1725))?.content, observation.content)
  assert.equal(await client.get(9), null)
})

test('a refused connection is EngramUnavailable', async () => {
  const fetch: FetchLike = async () => {
    throw new TypeError('fetch failed')
  }
  const client = createEngramClient({ baseUrl: 'http://127.0.0.1:7437', fetch })
  await assert.rejects(client.recent('engram', 5), (error: unknown) => {
    assert.ok(error instanceof EngramUnavailable)
    assert.match((error as Error).message, /127\.0\.0\.1:7437/)
    return true
  })
})

test('a server error carries Engram error message', async () => {
  const { fetch } = fakeFetch({ '/search': { status: 500, body: { error: 'database is locked' } } })
  const client = createEngramClient({ baseUrl: 'http://x', fetch })
  await assert.rejects(client.search('p', 'q', 5), /database is locked/)
})
