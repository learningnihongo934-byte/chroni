import type { EngineInterface, Register } from 'claude-code'

import { isFirstParty, muteInstructions, muteListing, serverOf } from './diet.ts'
import { outline } from './outline.ts'
import { fmt, passThrough, squeeze, tokens } from './squeeze.ts'

// Full logs rotate through this many files, so disk use stays bounded.
const LOG_SLOTS = 200
// Reads of text files longer than this, with no offset/limit, get the head plus a map.
const READ_MIN_LINES = 600
const READ_HEAD_LINES = 250
// A tool server unused for this long has its instructions and listing hidden.
const MCP_IDLE_MS = 14 * 24 * 60 * 60 * 1000
// Context sizes (tokens) at which to suggest /handoff, once each per session.
const NUDGE_AT = [80_000, 150_000, 300_000]

const FEATURES = {
  output: 'trims noisy command output',
  reads: 'maps big files instead of reading them whole',
  lean: 'asks Claude for shorter replies',
  tools: 'hides unused tool servers',
} as const
type Feature = keyof typeof FEATURES

const LEAN = `# Keep replies lean (Chroni)
Every word you write is paid for, and re-read on every later message. So:
- Lead with the answer or the result. No preamble ("Great question", "I'll now..."), no closing summary of what you just did unless asked.
- Don't restate the question, the plan you already shared, or tool output the user can already see.
- When you change code, don't re-print unchanged code; name the file and line and show only what changed, if anything.
- Prefer one precise sentence over three loose ones; use lists only when they are shorter.
This is about wording only: never skip reasoning, verification, tests, caveats, or details the user needs to act.`

const TEXT_FILE = /\.(?!(png|jpe?g|gif|webp|bmp|ico|icns|pdf|ipynb|zip|gz|tar|wasm|woff2?|ttf|otf|mp[34]|mov|db|sqlite)$)[^./]+$/i

// --- session state (a reload starts these over; lasting values go in $.store) ---
const saved: Record<Feature, number> = { output: 0, reads: 0, lean: 0, tools: 0 }
// server → its hidden instructions; saved in $.store too, so a reload keeps them.
const hidden = new Map<string, string>()
const servers = new Set<string>() // tool servers this session offers
const restored = new Set<string>()
const nudged = new Set<number>()
let promptCounted = false

// Claude often runs several tools at once. Store writes go through this queue
// so two calls never claim the same log slot or lose each other's counts.
let queue: Promise<unknown> = Promise.resolve()
function serial<T>(work: () => Promise<T>): Promise<T> {
  const run = queue.then(work)
  queue = run.catch(() => undefined)
  return run
}

const num = async ($: EngineInterface, key: string) => ((await $.store.get(key)) as number | undefined) ?? 0

async function isOn($: EngineInterface, feature: Feature) {
  if ((await $.store.get('off')) === true) return false
  return (await $.store.get(`off:${feature}`)) !== true
}

async function saveLog($: EngineInterface, raw: string): Promise<string | undefined> {
  try {
    const home = await $.env.get('HOME')
    if (!home) return undefined
    const slot = await serial(async () => {
      const n = await num($, 'slot')
      await $.store.set('slot', n + 1)
      return n % LOG_SLOTS
    })
    const path = `${home}/.claude/chroni/logs/output-${slot}.log`
    // $.fs.write caps at 4 MiB; leave room for multi-byte characters.
    await $.fs.write(path, raw.length > 3_500_000 ? raw.slice(-3_500_000) : raw)
    return path
  } catch {
    return undefined
  }
}

async function record($: EngineInterface, feature: Feature, savedChars: number) {
  if (savedChars <= 0) return
  const n = tokens(savedChars)
  saved[feature] += n
  await serial(async () => {
    await $.store.set('savedTokens', (await num($, 'savedTokens')) + n)
    await $.store.set(`saved:${feature}`, (await num($, `saved:${feature}`)) + n)
    await $.store.set('trims', (await num($, 'trims')) + 1)
  })
  const session = Object.values(saved).reduce((a, b) => a + b, 0)
  $.ui.status(`chroni: ~${fmt(session)} tokens saved this session`)
}

// Claude Code cuts very long output itself before any hook sees it, leaving
// a marker like "[19636 characters truncated]". Chroni can't recover that part.
const PRE_CUT = /\[(\d[\d,]*) (characters|lines) truncated\]/

const note = (linesBefore: number, linesAfter: number, path: string | undefined, raw: string) => {
  const head =
    `[chroni: trimmed ${linesBefore.toLocaleString()} lines of output to ${linesAfter.toLocaleString()} ` +
    `(kept the start, the end, and every error/warning-looking line). `
  const cut = PRE_CUT.exec(raw)
  if (cut)
    return (
      head +
      `Claude Code had already cut ${cut[1]} ${cut[2]} from the middle before Chroni saw it, so errors may be missing ` +
      `and the saved log${path ? ` (${path})` : ''} is incomplete too. If you need the rest, re-run the command with ` +
      `its output sent to a file (cmd > /tmp/out.log 2>&1) and grep that file.]`
    )
  return (
    head +
    (path
      ? `Full output: ${path} (Read or grep it if you need something that was cut.)]`
      : `Re-run with CHRONI=off in front of the command for the full output.]`)
  )
}

// Which tool servers to hide. Each server is decided once per session, the
// first time it shows up, so the prompt stays the same and stays cached.
let policy: { isOn: boolean; used: Record<string, number>; keep: string[] } | undefined
const decided = new Map<string, boolean>()

async function loadPolicy($: EngineInterface) {
  if (!policy) {
    const saved = ((await $.store.get('mcpHidden')) as Record<string, string> | undefined) ?? {}
    for (const [k, v] of Object.entries(saved)) if (!hidden.has(k)) hidden.set(k, v)
    for (const s of ((await $.store.get('mcpServers')) as string[] | undefined) ?? []) servers.add(s)
  }
  policy ??= {
    isOn: await isOn($, 'tools'),
    used: ((await $.store.get('mcpUsed')) as Record<string, number> | undefined) ?? {},
    keep: ((await $.store.get('mcpKeep')) as string[] | undefined) ?? [],
  }
  return policy
}

function isMuted(server: string) {
  const known = decided.get(server)
  if (known !== undefined) return known
  const p = policy
  const mute =
    !!p && p.isOn && !isFirstParty(server) && !p.keep.includes(server.toLowerCase()) &&
    Date.now() - (p.used[server] ?? 0) > MCP_IDLE_MS
  decided.set(server, mute)
  return mute
}

async function remember($: EngineInterface, removed: { server: string; body: string }[]) {
  if (!removed.length) return
  for (const b of removed) hidden.set(b.server, b.body)
  await serial(async () => $.store.set('mcpHidden', Object.fromEntries(hidden)))
}

const isServer = (name: string) => servers.size === 0 || servers.has(name)

const mutedNow = () => [...decided].filter(([, m]) => m).map(([s]) => s)

async function markUsed($: EngineInterface, server: string) {
  await serial(async () => {
    const used = ((await $.store.get('mcpUsed')) as Record<string, number> | undefined) ?? {}
    used[server] = Date.now()
    await $.store.set('mcpUsed', used)
  })
}

/**
 * The hidden instructions of muted servers that `text` names, once each per
 * session. A server counts as named by one of its tool names, or, in a search
 * query, by its own name as a word ("blender scene" names Blender).
 */
function restore(text: string, query = '') {
  const back: string[] = []
  const words = query.toLowerCase().split(/[^a-z0-9]+/).filter(w => w.length >= 4)
  for (const [server, body] of hidden) {
    if (restored.has(server)) continue
    const name = server.toLowerCase()
    const isNamed = text.includes(`mcp__${server}__`) || words.some(w => name === w || name.split('_').includes(w))
    if (!isNamed) continue
    restored.add(server)
    back.push(`[chroni: instructions for the ${server} tools, hidden earlier to save tokens]\n${body.trim()}`)
  }
  return back
}

async function statsText($: EngineInterface) {
  const session = Object.values(saved).reduce((a, b) => a + b, 0)
  const lines = [`Chroni saved ~${fmt(session)} tokens this session, ~${fmt(await num($, 'savedTokens'))} all time.`]
  for (const f of Object.keys(FEATURES) as Feature[]) {
    const extra = f === 'lean' ? 'not counted' : `~${fmt(saved[f])} this session, ~${fmt(await num($, `saved:${f}`))} all time`
    lines.push(`  ${(await isOn($, f)) ? '●' : '○'} ${f.padEnd(6)} ${FEATURES[f]} (${extra})`)
  }
  const hiddenNow = mutedNow()
  if (hiddenNow.length) lines.push(`  Hidden tool servers: ${hiddenNow.join(', ')}. Keep one with /chroni keep <name>.`)
  try {
    const { context } = await $.session.usage()
    if (context.tokens)
      lines.push(
        `Context now: ~${fmt(context.tokens)} tokens${context.percent ? ` (${Math.round(context.percent)}% of the window)` : ''}. ` +
          `Every message re-sends it; /handoff resets it.`,
      )
  } catch {}
  lines.push('Turn one feature off with /chroni <feature> off, or everything with /chroni off.')
  return lines.join('\n')
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'chroni',
      description: 'Token savings so far, or turn Chroni features on/off',
      argumentHint: '[on|off|output|reads|lean|tools|keep <server>]',
    })
    return next(e)
  })

  on('command.run', { command: 'chroni' }, async ($, e) => {
    const [a = '', b = ''] = e.args.trim().split(/\s+/)
    const cmd = a.toLowerCase()
    const val = b.toLowerCase()
    if (cmd === 'off' || cmd === 'on') {
      await $.store.set('off', cmd === 'off')
      return { text: `chroni: everything is ${cmd}.` }
    }
    if (cmd in FEATURES && (val === 'off' || val === 'on')) {
      await $.store.set(`off:${cmd}`, val === 'off')
      const later = cmd === 'lean' || cmd === 'tools' ? ' (from the next session on)' : ''
      return { text: `chroni: ${cmd} is ${val}${later}.` }
    }
    if ((cmd === 'keep' || cmd === 'unkeep') && val) {
      const keep = ((await $.store.get('mcpKeep')) as string[] | undefined) ?? []
      const list = cmd === 'keep' ? [...new Set([...keep, val])] : keep.filter(k => k !== val)
      await $.store.set('mcpKeep', list)
      return { text: `chroni: always keeping ${list.length ? list.join(', ') : 'no servers'} (from the next session on).` }
    }
    return { text: await statsText($) }
  })

  // 1. Noisy command output.
  on('tool.call', { tool: 'Bash' }, async ($, e, next) => {
    const ran = await next(e)
    if (ran.deny !== undefined || passThrough(e.command) || !(await isOn($, 'output'))) return ran

    // A failing command (non-zero exit) arrives as one error text that starts
    // with "Exit code N". A hook can't answer with an error of its own, so the
    // trimmed text goes back as a normal result, the exit code still on top.
    if (ran.isError === true) {
      const raw = ran.text
      if (typeof raw !== 'string' || !/^Exit code \d+/.test(raw)) return ran
      const s = squeeze(raw)
      if (!s) return ran
      const path = await saveLog($, raw)
      await record($, 'output', s.charsBefore - s.charsAfter)
      const [first, ...rest] = s.text.split('\n')
      return {
        result: {
          stdout: `${first} (the command failed)\n${note(s.linesBefore, s.linesAfter, path, raw)}\n${rest.join('\n')}`,
          stderr: '',
          interrupted: false,
        },
        context: ran.context,
      }
    }

    const r = ran.result
    if (r.isImage || r.backgroundTaskId || r.persistedOutputPath || r.structuredContent) return ran

    const out = squeeze(r.stdout)
    const err = squeeze(r.stderr)
    if (!out && !err) return ran

    const raw = r.stderr ? `${r.stdout}\n--- stderr ---\n${r.stderr}` : r.stdout
    const path = await saveLog($, raw)
    const before = (out?.linesBefore ?? 0) + (err?.linesBefore ?? 0)
    const after = (out?.linesAfter ?? 0) + (err?.linesAfter ?? 0)
    await record($, 'output', (out ? out.charsBefore - out.charsAfter : 0) + (err ? err.charsBefore - err.charsAfter : 0))

    return {
      result: {
        ...r,
        stdout: `${note(before, after, path, raw)}\n${out ? out.text : r.stdout}`,
        stderr: err ? err.text : r.stderr,
      },
      context: ran.context,
    }
  }).catch(($, e, next) => next(e))

  // 2. Big file reads: the first lines plus a map of the rest, instead of all of it.
  on('tool.call', { tool: 'Read' }, async ($, e, next) => {
    const isWhole = e.offset === undefined && e.limit === undefined && !e.allow_large && !e.pages
    if (!isWhole || !TEXT_FILE.test(e.file_path) || !(await isOn($, 'reads'))) return next(e)
    let text: string
    try {
      text = (await $.fs.read(e.file_path)) as string
    } catch {
      return next(e)
    }
    const lines = text.split('\n')
    if (lines.length <= READ_MIN_LINES) return next(e)
    const map = outline(e.file_path, text, 150, READ_HEAD_LINES)
    if (!map) return next(e)

    const ran = await next({ ...e, limit: READ_HEAD_LINES })
    if (ran.deny !== undefined || ran.isError === true) return ran
    if ((ran.result as { type?: string } | undefined)?.type !== 'text') return ran

    const guide =
      `[chroni: ${e.file_path} has ${lines.length.toLocaleString()} lines. To save tokens you got lines 1–${READ_HEAD_LINES} ` +
      `and this map of the rest (line: what starts there). Read the parts you need with offset/limit, ` +
      `or pass allow_large: true if you truly need the whole file at once.]\n${map}`
    const shown = lines.slice(0, READ_HEAD_LINES).join('\n').length
    await record($, 'reads', text.length - shown - guide.length)
    return { ...ran, context: [...(ran.context ?? []), guide] }
  }).catch(($, e, next) => next(e))

  // 3. Lean replies, and 4. the tool-server diet, both in the system prompt.
  on('prompt.compose', async ($, e, next) => {
    const composed = await next(e)
    await loadPolicy($)
    const offered = e.tools.map(serverOf).filter((x): x is string => !!x)
    if (offered.some(x => !servers.has(x))) {
      for (const x of offered) servers.add(x)
      await serial(async () => $.store.set('mcpServers', [...servers]))
    }
    let removedChars = 0
    const removed: { server: string; body: string }[] = []
    const sections = composed.sections.map(section => {
      const m = muteInstructions(section.text, isMuted, isServer)
      if (!m) return section
      removed.push(...m.removed)
      removedChars += section.text.length - m.text.length
      return { ...section, text: m.text }
    })
    await remember($, removed)
    // The prompt is re-sent on every request; count it once per session.
    if (removedChars > 0 && !promptCounted) {
      promptCounted = true
      await record($, 'tools', removedChars)
    }
    if (await isOn($, 'lean')) sections.push({ id: 'chroni:lean', text: LEAN, scope: 'session' as const })
    return { sections }
  }).catch(($, e, next) => next(e))

  // The deferred tool listing (and some instructions) arrive as reminders.
  on('prompt.attachment', async ($, e, next) => {
    const got = await next(e)
    if (typeof got.text !== 'string') return got
    await loadPolicy($)
    const isListing = e.type.includes('deferred_tools') || /^mcp__/m.test(got.text)
    const m = isListing ? muteListing(got.text, isMuted) : muteInstructions(got.text, isMuted, isServer)
    if (!m) return got
    if ('removed' in m) await remember($, m.removed)
    await record($, 'tools', got.text.length - m.text.length)
    return { ...got, text: m.text }
  }).catch(($, e, next) => next(e))

  // When Claude reaches for a hidden server, hand its instructions back.
  on('tool.call', { tool: 'ToolSearch' }, async ($, e, next) => {
    const ran = await next(e)
    await loadPolicy($)
    if (ran.deny !== undefined || hidden.size === 0) return ran
    // The result may carry tool references rather than text, so look everywhere.
    let seen = ran.text ?? ''
    try { seen += JSON.stringify(ran.result) } catch {}
    const query = String((e as { query?: unknown }).query ?? '')
    const back = restore(`${seen}\n${query}`, query)
    return back.length ? { ...ran, context: [...(ran.context ?? []), ...back] } : ran
  }).catch(($, e, next) => next(e))

  on('tool.call', async ($, e, next) => {
    const server = serverOf(e.tool)
    if (!server) return next(e)
    const ran = await next(e)
    await markUsed($, server)
    await loadPolicy($)
    if (ran.deny !== undefined) return ran
    const back = restore(`mcp__${server}__`)
    return back.length ? { ...ran, context: [...(ran.context ?? []), ...back] } : ran
  }).catch(($, e, next) => next(e))

  // 5. When the conversation gets big, suggest /handoff (each later message re-sends it all).
  on('turn.complete', async ($, e, next) => {
    const done = await next(e)
    try {
      const { context } = await $.session.usage()
      const size = context.tokens ?? 0
      const at = NUDGE_AT.filter(n => size >= n && !nudged.has(n)).pop()
      if (at) {
        for (const n of NUDGE_AT) if (n <= at) nudged.add(n)
        $.ui.toast(
          `chroni: this chat is ~${fmt(size)} tokens, re-sent with every message. ` +
            `/handoff then /clear makes the next messages ~90% cheaper.`,
          { timeoutMs: 12_000 },
        )
      }
    } catch {}
    return done
  }).catch(($, e, next) => next(e))
}
