# Changelog

## Unreleased

### Added — consolidation from runtime fork

This release brings Grounded MCP in line with work developed in the downstream
fork used for the `product@dhwaniris.com` runtime. Going forward, Grounded MCP
is the single source of truth for all MCP connector work.

- **Unified `renderOutbound({content, target})`** — one canonical formatting pipeline. Parses input to an AST (paragraph | bullet-list | divider), then serializes target-specific (Teams uses `<div>`, Email uses `<p>` wrapped in an email-safe HTML shell).
- **Inline HTML preservation** — `<strong>`, `<em>`, `<a>`, and `<at>` mention tags survive round-trip through the AST and serializers. Teams `@mention` markers pass through `escapeHtml()` verbatim (placeholder substitution) so Graph doesn't reject mention sends.
- **Calendar event bodies routed through `renderOutbound`** — calendar invites get the same formatting discipline as Teams and email.
- **Markdown detection with warning** — `detectMarkdown()` exported; `renderOutbound` emits `console.warn` when markdown is detected in outbound content. Content is not modified — callers are expected to pass explicit HTML if they want bold/italic. This replaces the silent-strip behavior from v1.0.0.
- **CI gate** — `.github/workflows/server-tests.yml` runs Jest on every change touching `server/**`, with a dedicated "format discipline" step that re-runs outbound-format, Teams, and Teams mention tests independently.

### Changed

- `serializeTeams` now prefers `block.rawHtml` over escaped plain text when available — preserves inline formatting in Teams output.
- `escapeHtml` preserves `<at id="N">...</at>` mention markers via placeholder substitution.
- `teams_chat.mentions` parameter description expanded (see `server/teams/consolidated/index.js`) to explicitly warn that bolding a name is not a mention — MCP consumers must pass a `mentions` array entry with an AAD user id, matched by `<at id="N">` tags in content, or the "tag" silently fails. Also documents the edit-vs-notify rule: `update_message` preserves mentions if re-passed but never re-triggers notifications. New platform-fact reference: `server/docs/TEAMS-MENTIONS.md`.

### Docs

- **Venue booking reference** — new platform-fact doc `server/docs/CALENDAR-VENUES.md` covering how to actually reserve a physical room via `calendar.create`. Setting the `location` field reserves nothing; the room's resource mailbox must be passed as an attendee for Exchange to auto-accept/decline and block the room's calendar. Covers: the `location`-vs-attendee trap, discovering a room's resource email, auto-response timing (5–15s, via mail, not in the create response), recovery when a room declines (delete+recreate, not update — the update path silently drops attendees), and `findMeetingTimes` caveats when rooms are in the attendee list.

### Removed

- Silent markdown stripping (`stripMarkdown()`, `containsMarkdown()` exports from PR #1). Replaced with the warning approach above. Agents that silently stripped markdown should now either pass HTML directly or expect the warning log.

## v1.0.0 — Initial OSS Release

**Released:** 2026-04-11  
**Base:** [hvkshetry/office-365-mcp-server](https://github.com/hvkshetry/office-365-mcp-server)

### Added (vs upstream)

- **Safety hooks** (`hooks/`): credential guard, pre-tool-use blocker, post-tool-use audit log for Claude Code sessions
- **Outbound format discipline**: `server/utils/outbound-format.js` — structured sign-off injection, HTML formatting for email replies and Teams messages
- **OUTBOUND_SIGN_OFF env control**: env-configurable sign-off; set to empty string for clean-pipe mode (no sign-off appended)
- **Runtime verification**: `npm run runtime:info` returns live fingerprint (version, commit, branch, dirty flag, PID, start time, entrypoint)
- **Post-restart smoke test**: `npm run smoke:live-format` validates live formatting behavior against real M365 targets
- **Operational security docs**: RULES.md, SECURITY.md, SETUP-GUIDE.md
- **Consolidated tool architecture**: operation-based routing reduces tool sprawl

### Changed (vs upstream)

- Sign-off constants extracted from individual Teams modules → centralized `DEFAULT_SIGN_OFF` in `outbound-format.js`
- CSS class `prody-reply-block` → `mcp-reply-block` (email HTML reply wrapper)
- Clone URLs updated to `Doot-Workspaces/grounded-mcp`
