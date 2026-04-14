# CLAUDE.md — Grounded MCP

> Read this at the start of any session touching this project.

## What This Project Is

Grounded MCP is a distribution of [hvkshetry/office-365-mcp-server](https://github.com/hvkshetry/office-365-mcp-server) (MIT licensed), extended with safety hooks, credential guard, outbound format discipline, runtime verification, and operational security docs. It connects Claude Code and other MCP-compatible tools to Microsoft 365 via Microsoft Graph API, with a focus on safety posture and operational discipline for corporate use.

## Credentials

Stored in `.env` files (gitignored). Always `chmod 600`. Never echo, print, or share credentials in output.

- Root `.env` — Azure app registration credentials
- `server/.env` — Server-specific credentials (client ID, secret, tenant ID, redirect URI)

When documenting auth failures, keep tenant messaging generic. Do not hardcode specific customer, tenant, or organization names into setup guidance, blocked-state notes, or troubleshooting text.

## Key Decisions

1. **MCP Server:** office-365-mcp-server (15 tools, covers all M365 services in one server)
2. **Auth:** OAuth2 delegated flow via Entra ID (acts as signed-in user, not app-level)
3. **Port:** Auth server runs on port 3000 (configured in redirect URI)
4. **Safety:** All email/Teams sends require explicit user approval. No exceptions.
5. **Sign-off:** Controlled via `OUTBOUND_SIGN_OFF` env variable — see below.

## OUTBOUND_SIGN_OFF

The `OUTBOUND_SIGN_OFF` env variable controls whether a sign-off is appended to outbound email and Teams messages.

- **Not set** → defaults to `-agent` suffix sign-off
- **Set to a value** (e.g., `OUTBOUND_SIGN_OFF="Sent via AI assistant"`) → uses that value
- **Set to empty string** (`OUTBOUND_SIGN_OFF=`) → clean-pipe mode: no sign-off appended at all

Set it in `server/.env`.

## Safety Rules

- NEVER send emails without showing the full draft and getting explicit "yes"
- NEVER send Teams messages to external channels without approval
- NEVER echo credentials from `.env` files
- NEVER commit `.env` files
- See [RULES.md](RULES.md) for full safety guidelines

## Setup

See [SETUP-GUIDE.md](SETUP-GUIDE.md) for step-by-step instructions.

## Workflow Discipline (Source of Truth Rules)

These rules exist to prevent the parallel-path drift that caused formatting regressions across forks.

**Canonical local path:** `~/Workspaces/grounded-mcp`. This is the one clone every Claude Code session and Codex session should operate from. Do not clone to other paths for the same repo.

**One session per repo at a time.** If another agent (Claude or Codex) is editing this repo, coordinate before opening a parallel session. Parallel edits on the same file in separate sessions are the documented root cause of formatting drift (mcp-m365-config fork, April 2026).

**Runtime equals upstream.** The live MCP runtime for `product@dhwaniris.com` is registered in `~/.claude/.mcp.json` pointing to `~/Workspaces/grounded-mcp/server/index.js`. Fix lands → `git pull` → MCP restart. There is no "fixed in runtime, will sync later."

**Retired repos:**
- `prody-dris/mcp-m365-config` (GitHub) — archived. Do not commit here.
- `~/Workspaces/mcp-m365-config` (local) — deleted after migration to grounded-mcp.

**CI gate:** `.github/workflows/server-tests.yml` runs Jest on every change touching `server/**`. The "format discipline" step protects outbound-format, Teams, and mention tests.

## Separation of Purpose

| Belongs in grounded-mcp | Belongs in prody-dris-agent |
|-------------------------|-----------------------------|
| Universal formatting (`renderOutbound`, AST, serializers) | Agent voice, tone, approval gates |
| Platform facts (markdown warning, `<at>` preservation, calendar routing) | Footer dedup (`— Prody`) |
| Security hooks in `hooks/` (generic) | Nihaan-on-CC enforcement |
| Tests for the connector | CC hook (`mcp-office365-guard.py`) |
| CI gate | Agent-specific guard scripts (e.g., `teams_message_guard.py` extras) |

If a rule applies to every MCP consumer, it goes here. If it's Prody's opinion or Nihaan's workflow, it goes to prody-dris-agent.

## Development Commands

```bash
cd server
npm install           # Install dependencies
npm test              # Run tests
npm run inspect       # MCP inspector
npm start             # Start server (stdio mode)
npm run auth-server   # Start OAuth authentication server (browser flow)
npm run runtime:info  # Print live runtime fingerprint
npm run smoke:live-format -- --mailbox ... --outlook-to ... --teams-chat-id ...
                      # Post-restart formatting smoke test
```
