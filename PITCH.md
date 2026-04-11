# Grounded MCP

> A grounded Claude-Code distribution of the Microsoft 365 MCP — based on [hvkshetry/office-365-mcp-server](https://github.com/hvkshetry/office-365-mcp-server), extended with safety hooks, credential guard, outbound format discipline, runtime verification, and operational security docs. Built for people who need AI on corporate M365 without footguns.

## Why this exists

The upstream MCP server gives you connectivity. What it doesn't give you is discipline.

When you put an AI agent on top of corporate email and Teams, the failure modes aren't about coverage — they're about control. Does the AI append its own signature to your outbound emails? Does it send without review? Can it leak credentials through a stray write? Does a restart silently roll back your config?

Grounded MCP answers all of these.

## What we built

Five additions on top of the upstream server:

| Addition | What it does |
|---|---|
| **Safety hooks** | Credential guard, destructive command blocker, audit log — wired into Claude Code's pre/post-tool-use hook system |
| **Outbound format discipline** | Consistent HTML formatting for email replies and Teams messages; configurable sign-off via `OUTBOUND_SIGN_OFF` env var |
| **Clean-pipe mode** | Set `OUTBOUND_SIGN_OFF=` (blank) to suppress all sign-off injection — zero modification to your output |
| **Runtime verification** | `npm run runtime:info` returns a live fingerprint: version, git commit, dirty flag, PID, entrypoint. Know exactly what's running. |
| **Operational security docs** | RULES.md (AI messaging safety principles), SECURITY.md (data flow, incident response), SETUP-GUIDE.md (step-by-step Azure setup) |

## Architecture

```
Claude Code
    └── Grounded MCP (local server)
            ├── Safety hooks (pre/post-tool-use)
            ├── Outbound format layer
            └── Microsoft Graph API
                    ├── Outlook
                    ├── Teams
                    ├── Calendar
                    ├── SharePoint / OneDrive
                    └── Directory / Planner / Contacts / To Do
```

All data stays local. No proxies, no third-party relay. Your tokens never leave your machine.

## Quick start

See [README.md](README.md) for full setup instructions.

tl;dr:
```bash
git clone https://github.com/Doot-Workspaces/grounded-mcp.git
cd grounded-mcp/server
npm install
cp .env.example .env   # fill in Azure credentials
npm run auth-server    # browser auth once
```

Then add to your `.mcp.json` and restart Claude Code.

## Safety posture

- **Hooks wired in**: credential-guard.py, pre-tool-use.sh, post-tool-use.sh run on every Claude Code tool call
- **Approval gates**: RULES.md recommends explicit "yes" before any outbound send — enforced by workflow, not by code alone
- **Format discipline**: outbound messages go through a formatting layer before hitting Graph API — no raw blobs, no accidental sign-off duplication

## Roadmap

Updates are driven by real usage. When something breaks or could be better, it goes into `learnings/` first, then into a PR.

No synthetic roadmap. Real fixes from real use.

## Attribution

Based on [hvkshetry/office-365-mcp-server](https://github.com/hvkshetry/office-365-mcp-server) (MIT). See [ATTRIBUTION.md](ATTRIBUTION.md) for full credit.

## Gumroad

[Grounded MCP on Gumroad — coming soon]

## Maintainers

- Nihaan Mohammed ([@nihaanmohammed](https://github.com/nihaanmohammed))
- Ankit ([@ankit-tbd](https://github.com/ankit-tbd))
