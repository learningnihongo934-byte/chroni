// Measures what chroni would save on real commands, and checks that no
// error-looking line is lost. Usage:
//   node --experimental-strip-types bench/bench.mjs "npm test" "git log --stat -n 300"
import { execSync } from 'node:child_process'
import { passThrough, squeeze, tokens, fmt } from '../hooks/squeeze.ts'

// Claude Code already cuts Bash output past this many characters on its own,
// so savings are counted against what the model would really have read.
const CLAUDE_CAP = 30_000

const SIGNAL = /\b(errors?|fail(ed|ure)?|fatal|panic|exception|traceback)\b/i
const commands = process.argv.slice(2)
if (commands.length === 0) {
  console.error('Give one or more shell commands to measure, each in quotes.')
  process.exit(1)
}

let totalBefore = 0
let totalAfter = 0
console.log('command'.padEnd(44), 'lines', '→', 'lines', '  tokens', '→', 'tokens', '  saved', ' errors kept')
for (const command of commands) {
  let out
  try {
    out = execSync(command, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 64 << 20 })
  } catch (err) {
    out = `${err.stdout ?? ''}${err.stderr ?? ''}`
  }
  // Past the cap Claude Code saves the output to a file and shows a short
  // preview itself; chroni leaves those alone, so they count as no change.
  if (out.length > CLAUDE_CAP) out = out.slice(0, 2_000)
  const s = passThrough(command) ? undefined : squeeze(out)
  const after = s ? s.text : out
  const signals = out.split('\n').filter(l => SIGNAL.test(l))
  const kept = signals.filter(l => after.includes(l.trim())).length
  const hiddenNote = /more error\/warning lines are in the full log/.test(after)
  totalBefore += out.length
  totalAfter += after.length
  const pct = out.length ? Math.round((1 - after.length / out.length) * 100) : 0
  console.log(
    command.slice(0, 44).padEnd(44),
    String(out.split('\n').length).padStart(5), '→', String(after.split('\n').length).padStart(5),
    fmt(tokens(out.length)).padStart(8), '→', fmt(tokens(after.length)).padStart(6),
    `${pct}%`.padStart(7),
    `${kept}/${signals.length}${hiddenNote ? ' (rest noted)' : ''}`.padStart(12),
  )
}
const pct = totalBefore ? Math.round((1 - totalAfter / totalBefore) * 100) : 0
console.log(`\nTotal: ~${fmt(tokens(totalBefore))} → ~${fmt(tokens(totalAfter))} tokens (${pct}% less)`)
