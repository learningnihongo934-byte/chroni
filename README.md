# Chroni

**Use Claude Code longer on the same plan, without making Claude dumber.**

Website and live demo: **https://chroni.web.app**

Most of your Claude usage isn't Claude thinking. It's Claude *reading*: build logs, whole files, tool lists, and the entire conversation, which is re-sent with every message. Chroni cuts the waste in five places, and leaves the thinking alone.

| | What Chroni does | Typical saving |
| --- | --- | --- |
| **1. Noisy output** | Trims long command output (builds, installs, tests, listings) to the start, the end and every error line. The full output is saved to a file. | 50–98% of that output |
| **2. Big file reads** | When Claude opens a 600+ line file whole, it gets the first 250 lines plus a map of where every function, class or heading starts, and reads only the parts it needs. | ~60–80% of that read |
| **3. Unused tool servers** | Tool servers (MCP) you haven't used in 14 days stop sending their long instructions and tool lists with every message. Their tools still work, and their instructions come back the moment Claude reaches for one. | Thousands of tokens on every message, depending on how many servers you have |
| **4. Lean replies** | Asks Claude to skip preambles, recaps and re-printed code. Reasoning, checks and caveats are untouched. | Fewer output tokens (not counted) |
| **5. Long sessions** | When a chat passes 80k tokens, Chroni tells you. `/handoff` writes a short summary so you can `/clear` and keep going. | ~90%+ per message after the handoff |

How much you save overall depends on your work: noisy builds and big files save the most, short Q&A the least. `/chroni` shows your real numbers.

## 1. Noisy output

Chroni keeps:

- **The start and the end** of the output, where commands say what they're doing and how it went
- **Every error and failure line**, with a line of context around each. Errors are never collapsed, even ones that differ only in a line number.
- **A pointer to the full output**, saved on disk, so Claude can open it if it ever needs something that was cut

Repeated lines, progress bars and long runs of near-identical warnings collapse to a few lines, and color codes are stripped.

It never touches:

- Small outputs (under about 4,000 characters and 80 lines), byte for byte
- Commands where Claude is reading something on purpose: `cat`, `head`, `tail`, `sed`, `grep`, `rg`, `jq`, `diff`, `git diff`, `git show`, `git log -p`, and anything piped through them
- Images and background commands
- Any command with `CHRONI=off` in front of it

Very large outputs (over about 30KB) are handled by Claude Code itself: it saves them to a file and shows Claude a short preview, before any plugin sees them. For a failing command it cuts the middle out instead; when that happens Chroni's note tells Claude so, and how to get the missing part.

Measured on real commands, against what Claude Code would already show on its own:

| Command | Before | After | Saved |
| --- | --- | --- | --- |
| `ls -laR` of an app folder | 7.5k tokens | 2.5k | 67% |
| `find . -name '*.py'` | 7.5k | 3.3k | 56% |
| `pip3 list -v` | 7.5k | 4.3k | 43% |
| `git log --stat -n 300` | 2.0k | 1.4k | 32% |
| A noisy 900-line failing build log (from the tests) | 7.9k | 0.1k | 98%, both errors kept |
| A noisy `npm install` with 160 deprecation warnings | | | 97%, both `ERR!` lines kept |

## 2. Big file reads

Measured on real 800–900 line files: a SwiftUI view went from 9.3k to 3.3k tokens (64% less) and a JavaScript app from 13.5k to 5.3k (61% less). Longer files save more. Reads with an `offset`/`limit`, files under 600 lines, images, PDFs and notebooks are untouched, and Claude can always pass `allow_large: true` to get a whole file.

## 3. Unused tool servers

Servers that are part of Claude's own apps (the browser, computer use, the desktop app's session tools) are never hidden. To always keep one, run `/chroni keep <server>`. The decision is made once per session, so the prompt stays the same and stays cached.

## Commands

- `/chroni`: tokens saved per feature, this session and all time, plus how big the current chat is
- `/chroni off`, `/chroni on`: pause or resume everything
- `/chroni <output|reads|lean|tools> off`: turn off one feature
- `/chroni keep <server>`: never hide that tool server
- `/handoff`: Claude writes a short handoff file. Run `/clear`, say "continue from .claude/handoff.md", and keep going with a fraction of the context.

Measure the output trimming on your own commands:

```bash
node --experimental-strip-types bench/bench.mjs "npm test" "npm run build" "ls -laR src"
```

## Install

At the prompt of a Claude Code terminal session:

```
/plugin install chroni --marketplace learningnihongo934-byte/chroni
```

Answer `y` to add the marketplace, then pick a scope (user is the default).

From a shell:

```bash
claude plugin install chroni --marketplace learningnihongo934-byte/chroni
```

In the Claude desktop app: click **+** next to the prompt box, then **Plugins**, **Add marketplace** with `learningnihongo934-byte/chroni`, then **Add plugin**.

## Develop

```bash
./build.sh            # validate and test
./build.sh install    # also install it from this folder for your own sessions
./build.sh deploy     # also publish the website to chroni.web.app
```

After editing, run `/reload-plugins` in Claude Code to pick up the changes.

- `hooks/squeeze.ts`: output trimming, plain functions with no engine calls
- `hooks/outline.ts`: the file maps for big reads
- `hooks/diet.ts`: hiding unused tool servers' instructions and listings
- `hooks/register.ts`: the Claude Code hooks that wire it all up, `/chroni`, savings tracking
- `commands/handoff.md`: the `/handoff` command
- `tests/`: tests run by `claude plugin test`
- `bench/bench.mjs`: measures savings on real commands
- `bench/demo.sh`: a noisy failing build; ask Claude to run it and watch it get trimmed
- `site/`: the website, deployed with `./build.sh deploy` (its demo runs the plugin's own code)

Full outputs are saved to `~/.claude/chroni/logs/`, rotating through 200 files so disk use stays bounded.

## License

Free to use; copying, redistributing or selling it is not allowed without permission. See [LICENSE](LICENSE).

---

Made by **Virat Reddy Kaukuntla** ([@learningnihongo934-byte](https://github.com/learningnihongo934-byte))
