import type { EngineInterface, Register } from 'claude-code'

import { fmt, passThrough, squeeze, tokens } from './squeeze.ts'

// Full logs rotate through this many files, so disk use stays bounded.
const LOG_SLOTS = 200

let sessionSaved = 0

async function isOff($: EngineInterface) {
  return (await $.store.get('off')) === true
}

async function saveLog($: EngineInterface, raw: string): Promise<string | undefined> {
  try {
    const home = await $.env.get('HOME')
    if (!home) return undefined
    const slot = (((await $.store.get('slot')) as number | undefined) ?? 0) % LOG_SLOTS
    await $.store.set('slot', slot + 1)
    const path = `${home}/.claude/chroni/logs/output-${slot}.log`
    // $.fs.write caps at 4 MiB; leave room for multi-byte characters.
    await $.fs.write(path, raw.length > 3_500_000 ? raw.slice(-3_500_000) : raw)
    return path
  } catch {
    return undefined
  }
}

async function record($: EngineInterface, savedChars: number) {
  const saved = tokens(savedChars)
  sessionSaved += saved
  const total = (((await $.store.get('savedTokens')) as number | undefined) ?? 0) + saved
  const trims = (((await $.store.get('trims')) as number | undefined) ?? 0) + 1
  await $.store.set('savedTokens', total)
  await $.store.set('trims', trims)
  $.ui.status(`chroni: ~${fmt(sessionSaved)} tokens saved this session`)
}

const note = (linesBefore: number, linesAfter: number, path: string | undefined) =>
  `[chroni: trimmed ${linesBefore.toLocaleString()} lines of output to ${linesAfter.toLocaleString()} ` +
  `(kept the start, the end, and every error/warning-looking line). ` +
  (path
    ? `Full output: ${path} (Read or grep it if you need something that was cut.)]`
    : `Re-run with CHRONI=off in front of the command for the full output.]`)

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'chroni',
      description: 'Token savings so far, or turn output trimming on/off',
      argumentHint: '[on|off]',
    })
    return next(e)
  })

  on('command.run', { command: 'chroni' }, async ($, e) => {
    const arg = e.args.trim().toLowerCase()
    if (arg === 'off' || arg === 'on') {
      await $.store.set('off', arg === 'off')
      return { text: `chroni: output trimming is ${arg}.` }
    }
    const total = ((await $.store.get('savedTokens')) as number | undefined) ?? 0
    const trims = ((await $.store.get('trims')) as number | undefined) ?? 0
    const state = (await isOff($)) ? 'off' : 'on'
    return {
      text:
        `chroni is ${state}. Saved ~${fmt(sessionSaved)} tokens this session, ` +
        `~${fmt(total)} tokens all time across ${trims} trimmed outputs.\n` +
        `Use /chroni off to pause it, /handoff to restart a long session cheaply.`,
    }
  })

  on('tool.call', { tool: 'Bash' }, async ($, e, next) => {
    const ran = await next(e)
    if (ran.deny !== undefined || passThrough(e.command) || (await isOff($))) return ran

    // A failing command (non-zero exit) arrives as one error text that starts
    // with "Exit code N". A hook can't answer with an error of its own, so the
    // trimmed text goes back as a normal result, the exit code still on top.
    if (ran.isError === true) {
      const raw = ran.text
      if (typeof raw !== 'string' || !/^Exit code \d+/.test(raw)) return ran
      const s = squeeze(raw)
      if (!s) return ran
      const path = await saveLog($, raw)
      await record($, s.charsBefore - s.charsAfter)
      const [first, ...rest] = s.text.split('\n')
      return {
        result: {
          stdout: `${first} (the command failed)\n${note(s.linesBefore, s.linesAfter, path)}\n${rest.join('\n')}`,
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
    await record($, (out ? out.charsBefore - out.charsAfter : 0) + (err ? err.charsBefore - err.charsAfter : 0))

    return {
      result: {
        ...r,
        stdout: `${note(before, after, path)}\n${out ? out.text : r.stdout}`,
        stderr: err ? err.text : r.stderr,
      },
      context: ran.context,
    }
  }).catch(($, e, next) => next(e))
}
