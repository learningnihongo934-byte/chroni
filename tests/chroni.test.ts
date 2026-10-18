import { expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'

// A long, noisy build log with two real errors buried in the middle.
const noisy = [
  '> app@1.0.0 build',
  ...Array.from({ length: 400 }, (_, i) => `Compiling module ${i} of 900 (${i * 3}ms)`),
  'src/api/user.ts(42,7): error TS2322: Type string is not assignable to type number.',
  ...Array.from({ length: 400 }, (_, i) => `info  bundling chunk-${i}.js ${i * 11} kB`),
  'ERROR in src/pages/home.tsx: Module not found: lodash',
  ...Array.from({ length: 100 }, (_, i) => `asset ${i}.png ${i} kB [emitted]`),
  'Build failed with 2 errors.',
].join('\n')

function world(on: On, answer: { stdout?: string; text?: string; isError?: boolean }) {
  const writes: { path: string; text: string }[] = []
  mock.store(on)
  mock.env(on, { HOME: '/home/test' })
  on('fs.write', ($, e) => {
    writes.push(e)
    return { value: undefined }
  })
  on('ui.status', () => ({ value: undefined }))
  on('tool.call', { tool: 'Bash' }, () =>
    answer.isError
      ? { isError: true, result: answer.text, text: answer.text }
      : { result: { stdout: answer.stdout ?? '', stderr: '', interrupted: false } },
  )
  return writes
}

test('trims a noisy log but keeps every error, the start and the end', async ($, on) => {
  const writes = world(on, { stdout: noisy })
  const ran = await $.tool.call({ tool: 'Bash', command: 'npm run build' })
  const out = (ran.result as { stdout: string }).stdout

  expect(out.startsWith('[chroni: trimmed')).toBe(true)
  expect(out.length).toBeLessThan(noisy.length / 4)
  expect(out).toContain('error TS2322')
  expect(out).toContain('Module not found: lodash')
  expect(out).toContain('> app@1.0.0 build')
  expect(out).toContain('Build failed with 2 errors.')
  expect(out).toContain('/home/test/.claude/chroni/logs/output-0.log')
  expect(writes[0]?.text).toBe(noisy)
})

test('leaves small output exactly as it was', async ($, on) => {
  world(on, { stdout: 'On branch main\nnothing to commit, working tree clean' })
  const ran = await $.tool.call({ tool: 'Bash', command: 'git status' })
  expect((ran.result as { stdout: string }).stdout).toBe('On branch main\nnothing to commit, working tree clean')
})

test('CHRONI=off passes the full output through', async ($, on) => {
  world(on, { stdout: noisy })
  const ran = await $.tool.call({ tool: 'Bash', command: 'CHRONI=off npm run build' })
  expect((ran.result as { stdout: string }).stdout).toBe(noisy)
})

test('trims a failing command too, as a result Claude Code accepts', async ($, on) => {
  const text = `Exit code 1\n${noisy}`
  world(on, { isError: true, text })
  const ran = await $.tool.call({ tool: 'Bash', command: 'npm test' })
  // Core only takes a Bash-shaped record from a hook, never a bare string.
  const out = (ran.result as { stdout: string }).stdout
  expect(typeof out).toBe('string')
  expect(out.startsWith('Exit code 1 (the command failed)')).toBe(true)
  expect(out).toContain('[chroni: trimmed')
  expect(out).toContain('error TS2322')
  expect(out.length).toBeLessThan(text.length / 4)
})

test('never trims commands that read content on purpose', async ($, on) => {
  world(on, { stdout: noisy })
  for (const command of ['cat build.log', 'git diff HEAD~3', 'grep -rn TODO src', 'cd app && sed -n 1,900p x.ts', 'git log -n 5 -p']) {
    const ran = await $.tool.call({ tool: 'Bash', command })
    expect((ran.result as { stdout: string }).stdout).toBe(noisy)
  }
})

test('says so when Claude Code already cut part of the output', async ($, on) => {
  const text = `Exit code 1\n${noisy.slice(0, 5000)}\n... [19636 characters truncated] ...\n${noisy.slice(-5000)}`
  world(on, { isError: true, text })
  const ran = await $.tool.call({ tool: 'Bash', command: 'npm run build' })
  const out = (ran.result as { stdout: string }).stdout
  expect(out).toContain('Claude Code had already cut 19636 characters')
  expect(out).toContain('cmd > /tmp/out.log 2>&1')
  expect(out).not.toContain('Full output:')
})

test('never collapses a run of errors, even ones that differ only in numbers', async ($, on) => {
  const errors = Array.from({ length: 30 }, (_, i) => `src/user.ts(${i * 7 + 3},5): error TS2322: Type 'string' is not assignable to type 'number'.`)
  const log = [...Array.from({ length: 300 }, (_, i) => `compiling module ${i}`), ...errors, 'Found 30 errors.'].join('\n')
  world(on, { stdout: log })
  const ran = await $.tool.call({ tool: 'Bash', command: 'npx tsc' })
  const out = (ran.result as { stdout: string }).stdout
  for (const line of errors) expect(out).toContain(line)
})

test('collapses a long run of near-identical warnings', async ($, on) => {
  const log = [...Array.from({ length: 160 }, (_, i) => `npm WARN deprecated pkg-${i}@1.${i}.0: no longer supported`), 'npm ERR! code ERESOLVE', 'added 900 packages'].join('\n')
  world(on, { stdout: log })
  const ran = await $.tool.call({ tool: 'Bash', command: 'npm install' })
  const out = (ran.result as { stdout: string }).stdout
  expect(out).toContain('similar lines')
  expect(out).toContain('npm ERR! code ERESOLVE')
  expect(out.split('\n').length).toBeLessThan(20)
})

test('parallel commands each get their own log file', async ($, on) => {
  const writes = world(on, { stdout: noisy })
  const runs = await Promise.all(Array.from({ length: 4 }, (_, i) => $.tool.call({ tool: 'Bash', command: `npm run build:${i}` })))
  const paths = runs.map(r => /Full output: (\S+)/.exec((r.result as { stdout: string }).stdout)?.[1])
  expect(new Set(paths).size).toBe(4)
  expect(new Set(writes.map(w => w.path)).size).toBe(4)
})

// ---------- big file reads ----------

const bigFile = Array.from({ length: 1500 }, (_, i) =>
  i % 50 === 0 ? `export function handler${i}(req: Request) {` : `  const value${i} = compute(${i}) // some code`,
).join('\n')

function readWorld(on: On, file: string) {
  const seen: { limit?: number; offset?: number }[] = []
  mock.store(on)
  mock.env(on, { HOME: '/home/test' })
  on('fs.read', () => ({ value: file }))
  on('fs.write', () => ({ value: undefined }))
  on('ui.status', () => ({ value: undefined }))
  on('tool.call', { tool: 'Read' }, ($, e) => {
    seen.push({ limit: e.limit, offset: e.offset })
    const shown = file.split('\n').slice(e.offset ?? 0, (e.offset ?? 0) + (e.limit ?? 2000))
    return { result: { type: 'text', file: { filePath: e.file_path, content: shown.join('\n'), numLines: shown.length, startLine: 1, totalLines: file.split('\n').length } } }
  })
  return seen
}

test('a big file read returns the first 250 lines plus a map of the rest', async ($, on) => {
  const seen = readWorld(on, bigFile)
  const ran = await $.tool.call({ tool: 'Read', file_path: '/repo/src/server.ts' })
  expect(seen[0]?.limit).toBe(250)
  const guide = (ran.context ?? []).join('\n')
  expect(guide).toContain('has 1,500 lines')
  expect(guide).toContain('1451: export function handler1450')
  expect(guide.length).toBeLessThan(bigFile.length / 5)
})

test('small files are read exactly as asked', async ($, on) => {
  const seen = readWorld(on, bigFile.split('\n').slice(0, 300).join('\n'))
  await $.tool.call({ tool: 'Read', file_path: '/repo/small.ts' })
  expect(seen[0]?.limit).toBe(undefined)
})

test('ranged reads and allow_large are read exactly as asked', async ($, on) => {
  const seen = readWorld(on, bigFile)
  await $.tool.call({ tool: 'Read', file_path: '/repo/a.ts', offset: 900, limit: 40 })
  await $.tool.call({ tool: 'Read', file_path: '/repo/a.ts', allow_large: true })
  expect(seen.map(s => s.limit)).toEqual([40, undefined])
})

// ---------- lean replies + tool diet ----------

const INSTRUCTIONS = `# MCP Server Instructions

The following MCP servers have provided instructions:

## blender
Very long Blender instructions. ${'Respect the scene graph. '.repeat(200)}

## ccd_session
App session tools.

## plugin:spritecook:spritecook
SpriteCook instructions. ${'Generate sprites. '.repeat(150)}
`

function promptWorld(on: On, used: Record<string, number> = {}) {
  mock.store(on, { mcpUsed: used })
  on('ui.status', () => ({ value: undefined }))
  on('prompt.attachment', () => ({ text: 'mcp__blender__run\nmcp__blender__render\nmcp__ccd_session__start\nWebFetch' }))
  on('tool.call', { tool: 'ToolSearch' }, () => ({ result: {}, text: 'Loaded: mcp__blender__run' }))
  on('prompt.compose', () => ({
    sections: [
      { id: 'intro', text: 'You are Claude.', scope: 'shared' as const },
      { id: 'mcp_instructions', text: INSTRUCTIONS, scope: 'session' as const },
    ],
  }))
}
const TOOLS = ['Bash', 'Read', 'mcp__blender__run', 'mcp__ccd_session__start', 'mcp__plugin_spritecook_spritecook__generate']
// Everything a real system-prompt build carries.
const COMPOSE = { tools: TOOLS, model: 'claude-opus-5-5', promptModel: 'claude-opus-5-5', surfaces: [], outputStyle: null, traits: [] } as never

test('hides unused tool servers, keeps first-party ones, and adds lean replies', async ($, on) => {
  promptWorld(on)
  const { sections } = await $.prompt.compose(COMPOSE)
  const mcp = sections.find(s => s.id === 'mcp_instructions')!.text
  expect(mcp).not.toContain('Respect the scene graph')
  expect(mcp).not.toContain('Generate sprites')
  expect(mcp).toContain('## ccd_session')
  expect(mcp).toContain('Chroni hid the instructions')
  expect(mcp.length).toBeLessThan(INSTRUCTIONS.length / 4)
  expect(sections.at(-1)?.id).toBe('chroni:lean')
})

test('keeps a tool server that was used recently', async ($, on) => {
  promptWorld(on, { blender: Date.now() })
  const { sections } = await $.prompt.compose(COMPOSE)
  const mcp = sections.find(s => s.id === 'mcp_instructions')!.text
  expect(mcp).toContain('Respect the scene graph')
  expect(mcp).not.toContain('Generate sprites')
})

test('hidden servers drop out of the deferred tool listing', async ($, on) => {
  promptWorld(on)
  await $.prompt.compose(COMPOSE)
  const got = await $.prompt.attachment({ type: 'deferred_tools_delta', text: '', origin: { kind: 'engine' } } as never)
  expect(got.text).not.toContain('mcp__blender__run')
  expect(got.text).toContain('mcp__ccd_session__start')
  expect(got.text).toContain('WebFetch')
  expect(got.text).toContain('blender (2)')
})

test('a hidden server gets its instructions back when Claude searches for it', async ($, on) => {
  promptWorld(on)
  await $.prompt.compose(COMPOSE)
  const ran = await $.tool.call({ tool: 'ToolSearch', query: 'select:mcp__blender__run', max_results: 1 } as never)
  expect((ran.context ?? []).join('\n')).toContain('Respect the scene graph')
})
