// Generated from hooks/squeeze.ts by build.sh. The same code the plugin runs.
// Pure text compression for noisy command output. No engine calls here,
// so it is easy to test and reason about.

                              
                                                                 
                  
                  
                                                                        
                  
                  
                   
                   
                                                                            
                        
 

export const DEFAULTS                 = {
  minChars: 4_000,
  minLines: 80,
  maxChars: 8_000,
  maxLines: 200,
  headLines: 40,
  tailLines: 80,
  maxSignalLines: 60,
}

                        
              
                     
                    
                     
                    
 

const ANSI = /\x1b\[[0-9;?]*[ -\/]*[@-~]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)|\x1b[()][0-9A-B]/g

// Lines worth keeping from the middle of a long log.
const SIGNAL =
  /\b(errors?|err!|fail(ed|ure|ures|ing)?|fatal|panic(ked)?|exception|traceback|assert(ion)?(error)?|warn(ing)?s?|denied|refused|not found|cannot|can't|unable|undefined|segmentation|timed? ?out|killed|abort(ed)?|expected|received|missing|invalid|conflict)\b|err!|✗|✖|❌|⨯|^\s*E\s{2,}|^\s*>\s+\d+\s*\|/i

// The subset of SIGNAL that means something went wrong, as opposed to a warning.
const ERROR_LINE =
  /\b(errors?|err!|fail(ed|ure|ures|ing)?|fatal|panic(ked)?|exception|traceback|assert(ion)?(error)?|segmentation|killed|abort(ed)?)\b|err!|✗|✖|❌|⨯|^\s*E\s{2,}/i

/** Strip colors and keep only the final state of carriage-return progress bars. */
export function clean(text        )           {
  return text
    .replace(ANSI, '')
    .split('\n')
    .map(line => {
      const parts = line.split('\r')
      for (let i = parts.length - 1; i >= 0; i--) {
        const part = parts[i] 
        if (part.trim() !== '') return part.trimEnd()
      }
      return ''
    })
}

// Two lines have the same "shape" when they differ only in numbers or hashes,
// like download progress or "Compiling foo v1.2.3" runs.
const shape = (line        ) =>
  line.replace(/\b[0-9a-f]{7,}\b/gi, 'H').replace(/\d+(\.\d+)?/g, '#').replace(/\s+/g, ' ')

/** Collapse exact repeats and long runs of same-shaped lines. */
export function collapse(lines          )           {
  const out           = []
  let i = 0
  while (i < lines.length) {
    const line = lines[i] 
    let j = i + 1
    while (j < lines.length && lines[j] === line) j++
    const repeats = j - i
    if (repeats >= 3) {
      out.push(line, `… (previous line repeated ${repeats - 1} more times)`)
      i = j
      continue
    }
    const s = shape(line)
    j = i + 1
    while (j < lines.length && lines[j] .trim() !== '' && shape(lines[j] ) === s) j++
    const run = j - i
    // Errors and failures are never collapsed: their numbers (line, column,
    // test id) are the point. Long runs of warnings that differ only in
    // numbers (160 "npm WARN deprecated pkg@1.2.3") do collapse, keeping more.
    const isError = ERROR_LINE.test(line)
    const isWarning = !isError && SIGNAL.test(line)
    if (!isError && run >= (isWarning ? 20 : 8)) {
      const keep = isWarning ? 5 : 2
      out.push(...lines.slice(i, i + keep), `… (${run - keep - 1} similar lines)`, lines[j - 1] )
      i = j
      continue
    }
    out.push(line)
    i++
  }
  // Squash runs of blank lines to one.
  return out.filter((line, k) => !(line === '' && out[k - 1] === ''))
}

/** Keep the head, the tail, and error-looking lines (with a line of context) in between. */
export function window(lines          , o                )           {
  if (lines.length <= o.headLines + o.tailLines) return lines
  const head = lines.slice(0, o.headLines)
  const tailStart = lines.length - o.tailLines
  const tail = lines.slice(tailStart)

  const keep = new Set        ()
  let signals = 0
  let extraSignals = 0
  for (let k = o.headLines; k < tailStart; k++) {
    if (!SIGNAL.test(lines[k] )) continue
    if (signals >= o.maxSignalLines) {
      extraSignals++
      continue
    }
    signals++
    for (const n of [k - 1, k, k + 1]) if (n >= o.headLines && n < tailStart) keep.add(n)
  }

  const middle           = []
  let last = o.headLines - 1
  for (const k of [...keep].sort((a, b) => a - b)) {
    if (k - last > 1) middle.push(`… (${k - last - 1} lines hidden)`)
    middle.push(lines[k] )
    last = k
  }
  if (tailStart - last > 1) middle.push(`… (${tailStart - last - 1} lines hidden)`)
  if (extraSignals > 0) middle.push(`… (${extraSignals} more error/warning lines are in the full log)`)
  return [...head, ...middle, ...tail]
}

/**
 * Returns the squeezed text, or undefined when the output is small enough
 * (or squeezing would barely help) and should be passed through untouched.
 */
export function squeeze(text        , o                 = DEFAULTS)                       {
  const linesBefore = text.split('\n').length
  if (text.length <= o.minChars && linesBefore <= o.minLines) return undefined

  let lines = collapse(clean(text))
  let joined = lines.join('\n')
  if (joined.length > o.maxChars || lines.length > o.maxLines) {
    lines = window(lines, o)
    joined = lines.join('\n')
  }
  // Long single lines (minified JSON, base64) survive the line window; cap them.
  if (joined.length > o.maxChars * 3) {
    lines = lines.map(l => (l.length > 2_000 ? `${l.slice(0, 1_000)} … (${l.length - 1_500} chars hidden) … ${l.slice(-500)}` : l))
    joined = lines.join('\n')
  }

  // Not worth it: keep the original byte for byte.
  if (joined.length > text.length * 0.8) return undefined
  return { text: joined, linesBefore, linesAfter: lines.length, charsBefore: text.length, charsAfter: joined.length }
}

// Commands whose whole point is to show specific content (a file, a diff,
// search matches) are never trimmed: cutting them would only cause re-reads.
const READS_CONTENT =
  /(^|[;&|(]\s*|\bxargs\s+|\bsudo\s+)(cat|head|tail|sed|awk|bat|nl|jq|yq|less|more|xxd|od|diff|grep|egrep|rg|ag|ack)\b|\bgit\s+(diff|show|blame|cat-file)\b|\bgit\s+log\b[^|;&]*\s(-p|-u|--patch)\b|chroni\/logs|CHRONI=off/

export const passThrough = (command        ) => READS_CONTENT.test(command)

/** Rough token estimate: about four characters per token for English and code. */
export const tokens = (chars        ) => Math.round(chars / 4)

export const fmt = (n        ) =>
  n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : n >= 1_000 ? `${(n / 1_000).toFixed(1)}k` : `${n}`
