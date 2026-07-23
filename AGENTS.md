# Repository Guidelines

## Session Start (Mandatory)

At the start of every agent session, before planning work or using tools, read
`CLAUDE.md` in full. Treat all repository guidance in `CLAUDE.md` as if it were
replicated verbatim in this file and follow it alongside the agent-specific
instructions below.

During that session-start check, compare `CLAUDE.md` with this file. If shared
repository guidance has been added or changed, update `AGENTS.md` in the same
session so the agent guidance remains aligned. Preserve agent-specific
instructions, including the Monday workflow below, when synchronizing.

## Monday Workflow

Use the `monday-tracker` skill for every non-trivial task in this repository.

Before making code changes:
- Create or find the matching monday.com item and move it to `Working on it`.
- If no item exists, create one on board `5092432355` with the correct typed prefix: `BUG-XX`, `IMP-XX`, `FEAT-XX`, or `UI-XX`.
- Always put the typed code at the very start of the item title, for example `IMP-11: ...`.
- If the board has a `Priority` column, keep it updated as part of normal MCP updates.
- Keep the description to one short paragraph.

After making code changes:
- Update the item to `Awaiting Testing` with a one-sentence summary in comments.
- Ask the user to test.
- If the user confirms success, move the item to `Done`.
- If the user reports failure, move the item to `Fixing` and continue.

Use only the configured Codex MCP server named `monday` for board operations.
Never use local Monday API scripts or direct token-based API calls for this repo workflow.

## Repo Notes

- The monday tracker reference file for this repo is `.agents/agents/monday-tracker.md`.
- If the user provides handoff notes, include the important points in the monday item description or comments rather than leaving them only in chat.
