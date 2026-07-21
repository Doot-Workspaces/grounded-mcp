# grounded-mcp — HEARTBEAT (session handoff)

**Last updated:** 2026-07-20
**Last operator:** CC (Sonnet 5, dispatched sub-agent)
**Next session:** PR #9 open against `main`, unreviewed. Do not merge without the maintainer running the two live-verification steps in the PR body.

---

## Session 2026-07-20 — Six root-caused fixes (calendar, Teams, timezone, room discovery)

### Done
- Created worktree at `/private/tmp/claude-501/-Users-nihaanmohammed-Documents-Projects-Prody/52675410-156f-4703-8170-944df99001f4/scratchpad/gmcp-fixes` on branch `fix/calendar-teams-incidents-2026-07-20` — main working tree (`~/Workspaces/grounded-mcp`, live MCP server) never touched: no checkout, no stash, no edits there.
- **Fix A:** `CALENDAR_SELECT_FIELDS` now requests `isOnlineMeeting,onlineMeeting`; `getCalendarEvent` renders real Yes/No + `Join URL:` line when present. List formatter (`formatCalendarResponse`) untouched.
- **Fix B:** `updateCalendarEvent` now pairs `isOnlineMeeting: true` with `onlineMeetingProvider: 'teamsForBusiness'` (mirrors create); turning off omits the provider field rather than guessing a Graph sentinel.
- **Fix C:** `parseHtmlToBlocks`/`parsePlainTextToBlocks` only strip a trailing sign-off block when `renderOutbound` is about to re-append its own (`stripTrailingSignOff` flag, driven by `Boolean(resolvedSignOff)`). Caller-authored standalone sign-off paragraphs no longer vanish silently.
- **Fix D:** bullet-list items in `parseHtmlToBlocks` now carry `{ content, rawHtml }` (parallel to paragraph `rawHtml`), so `<at id="N">Name</at>` mentions and other inline tags survive inside `<li>`. Confirmed via grep that `outbound-format.js` is the only consumer of the AST functions — no other file needed updates.
- **Fix E:** `getChatMessage` gained an optional `raw` boolean — returns `message.body.content` verbatim + `contentType` when true; default unchanged. Documented in `teams_chat` tool schema.
- **Fix F:** Added `'Asia/Kolkata': 'India Standard Time'` to `IANA_TO_MS_TIMEZONE` and `'India Standard Time': 'IST'` to the abbreviation map. `DEFAULT_TIMEZONE` code fallback deliberately untouched — maintainer must set `DEFAULT_TIMEZONE=Asia/Kolkata` in the runtime `.env` for `product@dhwaniris.com` (not done by this PR).
- **Fix G:** New `find_rooms` directory operation — `GET places/microsoft.graph.room`, same pattern as `search_users`. Degrades gracefully on 403 with a message naming `Place.Read.All`. Requires tenant admin consent (not granted by this PR).
- Ran `npm install` + `npx jest` in the worktree before and after changes. Baseline had 2 pre-existing failures (OAuth scope assertion expecting `OnlineMeetings.ReadWrite`; unrelated bug in `files/index.js` search) — both still present, unrelated to any of the 6 fixes, not touched. Final: `139 passed, 2 failed (pre-existing), 141 total`.
- Added tests: sign-off strip-what-you-re-add contract (3 cases), `<at>` mention in bullet round-trip, calendar get online-meeting Yes/No + Join URL + $select assertion, calendar update isOnlineMeeting/onlineMeetingProvider pairing, `get_message` raw vs default, `find_rooms` (list/empty/403-degrade).
- 4 commits on `fix/calendar-teams-incidents-2026-07-20`, pushed to origin, PR #9 opened base `main`.

### Pending
- Maintainer (Nihaan) review + the two live-verification smoke tests named in the PR body:
  1. Calendar create → update → get round-trip (Fix A + B) — confirm `Online Meeting:` and `Join URL:` are correct at every step, not just creation.
  2. Teams `send_message` (bullet + mention + inline sign-off) → `update_message` → `get_message` with `raw: true` (Fix C + D + E) — confirm mention and sign-off both round-trip without duplication or loss.
- `.env` change for Fix F (`DEFAULT_TIMEZONE=Asia/Kolkata`) — maintainer-applied at deploy, not in this PR.
- `Place.Read.All` admin consent for Fix G — maintainer/tenant-admin action, not in this PR.

### Blocked
- None. PR is ready for review; nothing is waiting on external input to proceed with the review itself.

### Next
- On merge: bounce the live MCP server process so it picks up the new code (this repo backs a running server — code changes alone don't take effect until restart).
- Worktree left in place per task instructions (not removed) at the scratchpad path above — safe to `git worktree remove` once the branch is merged or abandoned.

### Decisions
- Kept the two pre-existing test failures untouched — out of scope for this task, unrelated code paths (OAuth scope list, files search).
- FIX C's "strip always" test assertions were updated to the new strip-what-you-re-add contract — this was explicitly expected/correct per the task spec, not a scope violation.
- Chose to leave `Asia/Kolkata`/`Place.Read.All` as maintainer-actioned follow-ups (env + admin consent) rather than editing `.env` or attempting tenant-admin actions myself — both are explicitly out of bounds for a code PR.

---

## Files of interest (this session)

- `server/config.js` — Fix A (`CALENDAR_SELECT_FIELDS`) + Fix F (IANA/MS timezone maps)
- `server/calendar/index.js` — Fix A (`getCalendarEvent` output) + Fix B (`updateCalendarEvent` provider pairing)
- `server/utils/outbound-format.js` — Fix C (strip-what-you-re-add) + Fix D (bullet-list rawHtml)
- `server/teams/consolidated/teams_chat.js` + `server/teams/consolidated/index.js` — Fix E (`get_message` raw param + schema)
- `server/directory/index.js` — Fix G (`find_rooms`)
- `server/tests/calendar-render.test.js`, `server/tests/outbound-format.test.js`, `server/tests/teams-chat-mentions.test.js`, `server/tests/users.test.js` — new/updated tests for all six fixes

---

## Session metadata

- Task: six root-caused fixes in `grounded-mcp`, dispatched as a self-contained sub-agent task
- Working directory (isolated): `/private/tmp/claude-501/-Users-nihaanmohammed-Documents-Projects-Prody/52675410-156f-4703-8170-944df99001f4/scratchpad/gmcp-fixes`
- Repo: `https://github.com/Doot-Workspaces/grounded-mcp`
- Branch pushed: `fix/calendar-teams-incidents-2026-07-20`
- PR: https://github.com/Doot-Workspaces/grounded-mcp/pull/9
- Main working tree (`~/Workspaces/grounded-mcp`) never touched — no checkout, stash, or edits there (live MCP server constraint).
