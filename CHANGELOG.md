# Changelog

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
