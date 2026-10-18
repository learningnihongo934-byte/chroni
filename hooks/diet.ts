// The tool-server diet: hides the instructions and tool listings of MCP
// servers that aren't being used, so they stop riding along on every
// message. The tools themselves stay available through ToolSearch.

/** Servers that are part of Claude's own apps; never hidden. */
const FIRST_PARTY = /^(ccd_|claude-in-chrome$|Claude_Browser$|Claude_Code_iOS_Simulator$|computer-use$|terminal$|visualize$|scheduled-tasks$|mcp-registry$|remote-devices)/

export const isFirstParty = (server: string) => FIRST_PARTY.test(server)

/** `mcp__<server>__<tool>` → `<server>`; tool names write `:` and spaces as `_`. */
export const serverOf = (tool: string) => /^mcp__(.+?)__/.exec(tool)?.[1]

export const normalize = (name: string) => name.replace(/[^A-Za-z0-9-]/g, '_')

export type Instructions = { header: string; server: string; body: string }

/**
 * Splits the "# MCP Server Instructions" text into one block per server.
 * A server's own instructions may hold "# " and "## " headings of their own,
 * so a block only ends at a "## " heading that names a known server.
 */
export function splitInstructions(text: string, isServer: (name: string) => boolean = () => true) {
  const start = text.indexOf('# MCP Server Instructions')
  if (start < 0) return undefined
  const region = text.slice(start)
  const starts = [...region.matchAll(/^## (.+)$/gm)]
    .filter(m => isServer(normalize(m[1]!.trim())))
    .map(m => m.index!)
  if (starts.length === 0) return undefined
  const blocks: Instructions[] = starts.map((at, i) => {
    const body = region.slice(at, starts[i + 1] ?? region.length)
    const header = /^## (.+)$/m.exec(body)?.[1]?.trim() ?? ''
    return { header, server: normalize(header), body }
  })
  return { before: text.slice(0, start) + region.slice(0, starts[0]), blocks, after: '' }
}

export function stubLine(muted: string[]) {
  return (
    `\n(Chroni hid the instructions and tool lists of tool servers not used here recently, to save tokens: ` +
    `${muted.join(', ')}. Their tools still work: find them with ToolSearch, and their instructions come back when you do.)\n`
  )
}

/** Removes muted servers' blocks; returns the new text and what was removed. */
export function muteInstructions(text: string, isMuted: (server: string) => boolean, isServer?: (name: string) => boolean) {
  const split = splitInstructions(text, isServer)
  if (!split) return undefined
  const removed = split.blocks.filter(b => isMuted(b.server))
  if (removed.length === 0) return undefined
  const kept = split.blocks.filter(b => !isMuted(b.server))
  return {
    text: split.before + kept.map(b => b.body).join('') + stubLine(removed.map(b => b.header)) + split.after,
    removed,
  }
}

/** Drops muted servers' tool names from a deferred-tools listing. */
export function muteListing(text: string, isMuted: (server: string) => boolean) {
  const lines = text.split('\n')
  const dropped = new Map<string, number>()
  const kept = lines.filter(line => {
    const server = serverOf(line.trim())
    if (!server || !isMuted(server)) return true
    dropped.set(server, (dropped.get(server) ?? 0) + 1)
    return false
  })
  if (dropped.size === 0) return undefined
  const summary = [...dropped].map(([s, n]) => `${s} (${n})`).join(', ')
  kept.push(`(Chroni hid ${[...dropped.values()].reduce((a, b) => a + b, 0)} tools from servers not used here recently: ${summary}. They still load with ToolSearch.)`)
  return { text: kept.join('\n'), dropped }
}
