# Chroni

**Use Claude Code longer on the same plan, without making Claude dumber.**

Website and live demo: **https://chroni.web.app**

Most of your Claude usage isn't Claude's replies. It's everything Claude has to *read*, and the worst offenders are noisy command outputs. An `npm install`, a test run, a build log or a big directory listing can dump thousands of lines into the conversation, and that text is re-sent with every message after it.

Chroni trims that noise before Claude sees it, and keeps what matters:

- **The start and the end** of the output, where commands say what they're doing and how it went
- **Every error, failure and warning line**, with a line of context around each
- **A pointer to the full output**, saved on disk, so Claude can open it if it ever needs something that was cut

Repeated lines and progress bars ("Compiling 1 of 900…") collapse to a couple of lines, and color codes are stripped.

## What it never touches

- Small outputs (under about 4,000 characters and 80 lines), byte for byte
- Commands where Claude is reading something on purpose: `cat`, `head`, `tail`, `sed`, `grep`, `rg`, `jq`, `diff`, `git diff`, `git show`, `git log -p`, and anything piped through them
- Images and background commands
- Any command with `CHRONI=off` in front of it

Very large outputs (over about 30KB) are handled by Claude Code itself: it saves them to a file and shows Claude a short preview, before any plugin sees them. For a failing command it cuts the middle out instead; when that happens Chroni's note tells Claude so, and how to get the missing part.

## How much it saves

Measured on real commands, against what Claude Code would already show on its own (it cuts very large outputs itself):

| Command | Before | After | Saved |
| --- | --- | --- | --- |
| `ls -laR` of an app folder | 7.5k tokens | 2.5k | 67% |
| `find . -name '*.py'` | 7.5k | 3.3k | 56% |
| `pip3 list -v` | 7.5k | 4.3k | 43% |
| `git log --stat -n 300` | 2.0k | 1.4k | 32% |
| A noisy 900-line failing build log (from the tests) | 7.9k | 0.1k | 98%, both errors kept |
| A noisy `npm install` with 160 deprecation warnings | | | 97%, both `ERR!` lines kept |

Small commands like `git status` show 0%, because Chroni leaves them alone. Measure your own:

```bash
node --experimental-strip-types bench/bench.mjs "npm test" "npm run build" "ls -laR src"
```

## Commands

- `/chroni`: tokens saved this session and all time
- `/chroni off`, `/chroni on`: pause or resume trimming
- `/handoff`: when a session gets long, Claude writes a short handoff file. Run `/clear`, say "continue from .claude/handoff.md", and keep going with a fraction of the context.

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

- `hooks/squeeze.ts`: the trimming logic, plain functions with no engine calls
- `hooks/register.ts`: the Claude Code hooks (the Bash hook, `/chroni`, savings tracking)
- `commands/handoff.md`: the `/handoff` command
- `tests/`: tests run by `claude plugin test`
- `bench/bench.mjs`: measures savings on real commands
- `bench/demo.sh`: a noisy failing build; ask Claude to run it and watch it get trimmed
- `site/`: the website, deployed with `./build.sh deploy` (its demo runs the plugin's own code)

Full outputs are saved to `~/.claude/chroni/logs/`, rotating through 200 files so disk use stays bounded.

## License

MIT
