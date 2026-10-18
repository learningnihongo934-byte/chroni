---
description: Write a compact handoff so you can /clear and keep going with a fraction of the context
---

This session's context has grown large, and every new message re-sends all of it. Write a handoff so the work can continue in a fresh, small context without losing anything that matters.

Write it to `.claude/handoff.md` in the project (create the folder if needed), overwriting any earlier one. Keep it under 400 words. Include only:

1. **Goal**: what the user is trying to get done, in their words where possible.
2. **Done so far**: what changed, with file paths (and line numbers where useful). Skip anything already committed and obvious from `git log`.
3. **Decisions and constraints**: choices made and why, things the user said to do or avoid, approaches that were tried and failed.
4. **Current state**: what works, what's broken, what is unverified.
5. **Next steps**: the concrete next actions, in order.
6. **Key files**: the few files the next session should read first.

Do not paste code or command output into it; point to files instead. Then tell the user, in one short line: run `/clear`, then say "continue from .claude/handoff.md".

$ARGUMENTS
