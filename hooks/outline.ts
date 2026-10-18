// A map of a source file: the lines that name things (functions, classes,
// headings, top-level keys), each with its line number, so Claude can read
// just the part it needs. Plain functions, no engine calls.

const PATTERNS: [RegExp, RegExp][] = [
  // JavaScript / TypeScript
  [/\.(m|c)?(j|t)sx?$/, /^\s*(export\s+)?(default\s+)?(async\s+)?(function\*?|class|interface|type|enum|const|let|var)\s+[\w$]+|^\s{2,4}(static\s+|async\s+|get\s+|set\s+|private\s+|public\s+|protected\s+)*[\w$]+\s*\([^)]*\)\s*(:\s*[^{]+)?\{\s*$|^\s*(describe|it|test)\(/],
  // Python
  [/\.pyi?$/, /^\s*(async\s+)?(def|class)\s+\w+|^[A-Z_][A-Z0-9_]*\s*=/],
  // Go
  [/\.go$/, /^(func|type|var|const)\s/],
  // Rust
  [/\.rs$/, /^\s*(pub(\([^)]*\))?\s+)?(async\s+)?(fn|struct|enum|trait|impl|mod|type|const|static|macro_rules!)\s/],
  // Java, Kotlin, C#, Swift, Scala, Dart
  [/\.(java|kt|kts|cs|swift|scala|dart)$/, /^\s*(public|private|protected|internal|open|abstract|final|static|override|sealed|data|async|export|@\w+|\s)*\s*(class|interface|enum|struct|record|object|protocol|extension|fun|func|def|void|[\w<>\[\],]+\s+\w+\s*\()/],
  // C / C++ / Objective-C
  [/\.(c|h|cc|cpp|cxx|hpp|hh|m|mm)$/, /^(?!\s)(?!(if|for|while|switch|return|else)\b)[\w:*&<>,\s]+\s+[\w:*&]+\s*\([^;]*$|^\s*(class|struct|namespace|enum|typedef|#define)\s/],
  // Ruby, PHP, Lua, Elixir, shell
  [/\.(rb|rake)$/, /^\s*(def|class|module)\s/],
  [/\.php$/, /^\s*(abstract\s+|final\s+)?(public\s+|private\s+|protected\s+)?(static\s+)?(function|class|interface|trait)\s/],
  [/\.lua$/, /^\s*(local\s+)?function\s/],
  [/\.exs?$/, /^\s*(defmodule|def|defp|defmacro)\s/],
  [/\.(sh|bash|zsh)$/, /^\s*(function\s+)?[\w-]+\s*\(\)\s*\{|^\s*function\s+[\w-]+/],
  // Markup and config
  [/\.(md|mdx|markdown|rst|txt)$/, /^#{1,4}\s|^[=-]{3,}\s*$/],
  [/\.(html?|vue|svelte|astro)$/, /<(h[1-3]|section|header|footer|nav|main|template|script|style|form)\b|<\w+[^>]*\bid="/],
  [/\.(css|scss|sass|less)$/, /^[^\s{}][^{}]*\{\s*$|^@(media|keyframes|layer|supports)\b/],
  [/\.(ya?ml|toml)$/, /^[\w"'-][^:=]*[:=]|^\[/],
  [/\.json5?$/, /^\s{0,2}"[^"]+"\s*:/],
  [/\.sql$/, /^\s*(create|alter|insert|select|with)\b/i],
]

// Files where a map is no help (data, lock files, minified bundles).
const SKIP = /(\.lock|lock\.json|\.min\.(js|css)|\.map|\.svg|\.csv|\.tsv|\.log)$/i

/** `from`: skip the first lines (Claude already has them). */
export function outline(path: string, text: string, max = 150, from = 0): string | undefined {
  if (SKIP.test(path)) return undefined
  const rule = PATTERNS.find(([file]) => file.test(path))?.[1]
  const lines = text.split('\n')
  const hits: string[] = []
  const width = String(lines.length).length
  for (let i = from; i < lines.length; i++) {
    const line = lines[i]!
    if (line.length > 300) continue
    const isHit = rule ? rule.test(line) : /^[^\s#/*})\]-][^]*$/.test(line) && line.trim().length > 3
    if (isHit) hits.push(`${String(i + 1).padStart(width)}: ${line.trimEnd().slice(0, 140)}`)
  }
  if (hits.length === 0) return undefined
  if (hits.length <= max) return hits.join('\n')
  // Too many: keep the least indented ones, which are the top-level names.
  const indent = (h: string) => (h.split(': ')[1] ?? '').search(/\S/)
  const levels = [...new Set(hits.map(indent))].sort((a, b) => a - b)
  for (const level of levels) {
    const kept = hits.filter(h => indent(h) <= level)
    const next = hits.filter(h => indent(h) <= (levels[levels.indexOf(level) + 1] ?? Infinity))
    if (next.length > max) return kept.slice(0, max).join('\n') + (kept.length > max ? `\n… (${kept.length - max} more)` : '')
  }
  return hits.slice(0, max).join('\n') + `\n… (${hits.length - max} more)`
}
