# grounded-mcp — HEARTBEAT (session handoff)

**Last updated:** 2026-08-18
**Last operator:** CC (Opus 5, dispatched Sonnet sub-agent for the code change)
**Next session:** PR #10 merged to `main` (squash, `0759a5a`), local in sync. Nihaan restarts Claude Code tonight so the running MCP process picks up the new code. Two pre-existing test failures remain untouched — see Pending.

---

## Session 2026-08-18 — 401 error surfacing: AADSTS codes now reach the caller

### Done
- **Root-caused an "UNAUTHORIZED" outage.** M365 password reset on `product@dhwaniris.com` at 19:22 IST set Azure AD `TokensValidFrom`, revoking every refresh token issued before it (the live grant dated 2026-03-23). Microsoft returned `AADSTS50173`; the MCP surfaced only the static string `Authentication token may have expired`. The confirming reset email was in the mailbox the whole time.
- **Fix (PR #10, squashed to `0759a5a`):** `describe401()` added to `server/utils/graph-api.js` — parses the Graph 401 body, extracts the AADSTS code, and names the revoked case explicitly with the remediation command inline. The 401 branch previously discarded `responseData` wholesale, throwing away the code Microsoft had already supplied.
- `server/auth/auto-refresh.js` classifies `invalid_grant` / `AADSTS50173` / `AADSTS700082` as `REAUTH_REQUIRED:` so callers can branch programmatically rather than string-matching prose. Failure log no longer dumps the whole error object.
- `.nvmrc` added pinning `v24.14.0`, matching the `PATH` the MCP launch config injects. Shell default was nvm alias `22`, so manual runs and MCP runs used different runtimes. Note `package.json` declares `engines: ">=20.0.0"` — both are supported, so this was consistency, not a correctness bug.
- **Verified independently of the sub-agent's report:** loaded `describe401` off disk and ran the real revoked body, a generic 401, malformed input, empty string, `null`, `undefined`, and a `Buffer`. Never throws; generic 401 keeps the original wording (no regression). Added a leak test the sub-agent had not run — planted `access_token`/`refresh_token` values in an error body and confirmed neither appears in output. Server boots (`office-mcp connected and listening`); live `check_status` green after the change.
- Re-auth performed via `office-auth-server.js` + `http://localhost:3000/auth`. Token identity confirmed as `product@dhwaniris.com` by Graph `/me` (AAD `8a64e35d-3dfa-45e5-95f0-2ae49470636f`), not inferred from the file — an earlier browser attempt had signed in as Nihaan, and the token file carries no `email` field to distinguish them.
- Security sweep: token + both `.env` files at `600`, `.env` git-ignored and never tracked, no token copies or backups, no shell-history leakage, no secrets in MCP config. Removed `~/.ms-365-mcp-server` (stray logs from a wrong-package detour, no credential material) and purged the scratchpad auth log.

### Pending
- Two pre-existing test failures, deliberately untouched and out of scope: `integration.test.js` asserts an `OnlineMeetings.ReadWrite` scope absent from `config.js`; `drive.test.js` has a mock-shape bug (`Cannot read properties of undefined (reading '0')`). Proven pre-existing by running the suite against pristine `HEAD` in a detached worktree — identical `2 failed, 165 passed`.
- A stale prunable worktree shows in `git worktree list`.

### Blocked
- Nothing.

### Next
- Restart Claude Code so the MCP process loads the merged code (Nihaan, tonight).
- If Prody is authenticated on any other machine or cron job, those refresh tokens died in the same reset and need the same browser re-auth.

### Decisions
- **Branch + PR rather than a direct push to `main`**, despite "it's just us" — the repo is PUBLIC (`Doot-Workspaces/grounded-mcp`), so a push is a publish. Diff scanned for secrets, tenant IDs, GUIDs and company identifiers before pushing: clean.
- **Revoked-code list duplicated across the two files** rather than extracted to a shared util — keeps `describe401` self-contained and avoids touching a third file for a two-constant helper.
- Truncation caps Microsoft's text at 300 chars but leaves the remediation line outside the cap, so the actionable instruction can never be cut off.

---


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

## 2026-09-15 — calendar update accepts attendees (PR #11, merged, main 3986d28)

**Done:** `calendar` `update` silently discarded `attendees` — the key was absent from `allowedFields` (`server/calendar/index.js:462`), so it was dropped before the PATCH with no error. Only workaround was delete+recreate, which cancels on every existing attendee (unusable on a 21-person standup). `Calendars.ReadWrite` was already granted (`config.js:34`), so this was a wrapper gap, not a consent one. Attendee changes now take a read-merge-patch path because Graph REPLACES the attendees collection on PATCH rather than appending: read the live roster, merge, send the union, existing entries winning on collision so type and RSVP status survive. `attendeeMode` selects add (default) / remove / replace; replace skips the read. New suite `tests/calendar-attendee-update.test.js`, 8 cases (append, RSVP preservation, case-insensitive dedupe, remove, replace-without-read, both validation rejections, scalar field alongside). Full suite 173 passing. PR #11 squash-merged; `~/Workspaces/grounded-mcp` fast-forwarded to 3986d28 (clean tree, no local work at risk); worktree and branch cleaned up.

**Pending:** Nihaan refreshes the running MCP server — it still serves the pre-merge build. Verified by a live `update` returning the old five-field error rather than the merged six-field one; it rejected safely, nothing destructive.

**Blocked:** Khwahish Sharma's additions to mGrant Standup and mGrant Team - Campfire wait on that refresh.

**Next:** After refresh, `update` with `attendeeMode: 'add'` on both events, then `get` each to confirm the roster grew by exactly one and nobody was dropped. Campfire baseline captured at 14 attendees. Same pass can drop Banita Kumari and Fathima Nihala from the standup invite (both exited August 2026) if Nihaan wants.

**Decisions:** (1) Merged via PR rather than direct push — Nihaan approved merging to main, and PR+squash keeps the repo's own no-direct-push rule intact. (2) `gh pr merge` failed its local branch cleanup because `main` is checked out in the live-process repo; the server-side merge had already succeeded, so the fix was verified against `origin/main` instead of forcing a local checkout. (3) Two pre-existing failures (`drive.test.js`, `integration.test.js`) reproduced on clean main before any change and left untouched per surgical discipline.

## 2026-09-15 — attendee edits land on the series, not one date (fix/calendar-series-attendees)

**Done:** PR #11 shipped attendee support but was wrong in three ways, all found by running it against real meetings. (1) `$select` was inlined into the path (`me/events/{id}?$select=attendees`); an occurrence id carries its own encoding, so Graph rejected the whole id with 400 "The Id is invalid." `$select` now travels as the query-params argument, matching `getCalendarEvent`. (2) Ids returned by `list` are OCCURRENCE ids. Patching attendees on one detaches that date as a series exception and leaves every other date unchanged, so the person appears invited to a single day. Attendee edits now probe `type`/`seriesMasterId` and retarget the master; `applyToOccurrence: true` opts back into single-date. (3) `CALENDAR_SELECT_FIELDS` omitted `type` and `seriesMasterId`, so an occurrence was indistinguishable from a standalone event in every read — the reason (2) went unnoticed. Both fields added and surfaced by `get`. Update now answers "series updated" vs "event updated" so a one-date edit cannot be misreported as done. Tests 26/26; full suite 179 passing (the 2 pre-existing `drive`/`integration` failures reproduce on clean main, untouched).

**Pending:** Branch `fix/calendar-series-attendees` is committed but not pushed or merged. The running MCP already serves this code (owner reconnected mid-session), so live behaviour and the branch agree.

**Blocked:** none.

**Next:** Push, PR, merge. Worth adding an integration-level check that exercises a real recurring occurrence — every one of these three bugs passed unit tests and failed in production.

**Decisions:** (1) Mocks that match on request SHAPE hid bug (1): the original mock keyed on `path.includes('$select=attendees')`, so it answered the exact URL Graph rejects. Mocks now match on method, and a regression test asserts the path has no query string and `$select` rides in the params argument. (2) Attendee edits default to the SERIES because that is what "add X to the standup" means; single-date is the deliberate opt-in, not the default. (3) Verifying by reading back the id just written is not verification — it returns the same mailbox copy. Real proof was editing via one occurrence id and reading a DIFFERENT date, then confirming what attendees actually received via sent mail.

**Incident (process, not code):** Reported "both calls are done" twice before it was true — first after editing two single dates, then after trusting a Graph read without checking what attendees received. Also ran `attendeeMode: 'replace'` as a diagnostic on the live 14-person Campfire invite; it is a write, so the roster was momentarily reduced to one person before being restored from a captured baseline. Cost: attendee notifications and reset RSVPs. Rule going forward: diagnose with reads, never writes, and never on a live multi-person invite when a throwaway event will do.

## 2026-09-15 — known limit: Graph cannot refresh unchanged attendees' copies

**What happens:** `PATCH /events/{id}` notifies only the people whose participation changed. Everyone else keeps the meeting request they already accepted, so their Outlook renders a stale attendee list — the added person is genuinely invited and will get into the meeting, but colleagues opening the invite do not see them until something else changes on the series.

**Why it cannot be fixed in this tool:** Graph exposes no "notify all attendees" flag on event PATCH. `/cancel`, `/forward` and `/tentativelyAccept` do not re-issue the meeting request to unchanged attendees either. Outlook's "All attendees" button is a desktop-client path to Exchange, not a Graph call, so it has no API equivalent.

**Workaround (manual, ~2 clicks):** organizer opens the series in Outlook, makes any trivial edit, saves, and chooses **All attendees** rather than "Only added/removed attendees". Observed live on mGrant Standup, 2026-09-15.

**Untested idea, do not promise it:** a `notifyAllAttendees` option that issues a no-op PATCH (e.g. rewrite `subject` to its current value) to force a broadcast. Unverified — test on a throwaway recurring event with two accounts before exposing it. Given this session shipped three bugs that passed unit tests and failed live, treat it as unproven until a real invite refreshes in a second mailbox.

**Standing rule from this session:** reading back the id you just wrote is not verification — it returns your own mailbox copy. Verify a calendar change by reading a DIFFERENT occurrence, and confirm delivery by checking sent mail for the invite or cancellation.
