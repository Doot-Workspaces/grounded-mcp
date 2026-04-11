# Grounded MCP

> A grounded Claude-Code distribution of the Microsoft 365 MCP — based on [hvkshetry/office-365-mcp-server](https://github.com/hvkshetry/office-365-mcp-server), extended with safety hooks, credential guard, outbound format discipline, runtime verification, and operational security docs. Built for people who need AI on corporate M365 without footguns.

Connect **Claude Code**, **Claude Desktop**, or any MCP-compatible AI tool to **Microsoft 365** — Outlook, Teams, Calendar, SharePoint, Planner, and more.

Built on top of [office-365-mcp-server](https://github.com/hvkshetry/office-365-mcp-server) (MIT licensed), with added configuration scaffolding, security docs, safety rules, and a step-by-step setup guide.

## What You Get

| Service | Capabilities |
|---------|-------------|
| **Outlook** | Read, draft, send, reply, search, folders, rules, categories |
| **Teams** | Channel messages, chat, meeting management |
| **Calendar** | List, create, update, delete events |
| **SharePoint/OneDrive** | File upload, download, search |
| **Planner** | Task management |
| **Directory** | User profiles, org hierarchy, presence |
| **Contacts** | Contact management |
| **To Do** | Task lists and items |
| **Search** | Cross-service search |

**15 tools** available to your AI assistant, all via Microsoft Graph API.

## What We Added

Five additions on top of the upstream server:

| Addition | What it does |
|---|---|
| **Safety hooks** | Credential guard, destructive command blocker, audit log — wired into Claude Code's pre/post-tool-use hook system (`hooks/` directory) |
| **Outbound format discipline** | Consistent HTML formatting for email replies and Teams messages; configurable sign-off via `OUTBOUND_SIGN_OFF` env var (`server/utils/outbound-format.js`) |
| **Runtime verification** | `npm run runtime:info` returns a live fingerprint: version, git commit, dirty flag, PID, entrypoint. Know exactly what's running. |
| **Operational security docs** | RULES.md (AI messaging safety principles), SECURITY.md (data flow, incident response), SETUP-GUIDE.md (step-by-step Azure setup) |
| **OUTBOUND_SIGN_OFF env control** | Centralized sign-off behavior; set to empty string for clean-pipe mode (no sign-off appended) |

## Architecture

```
Claude Code / Claude Desktop / Any MCP Client
  └── MCP Server (runs locally on YOUR machine)
        ├── Safety hooks (pre/post-tool-use)
        ├── Outbound format layer
        └── Microsoft Graph API (OAuth2 delegated flow via Entra ID)
              ├── Outlook    (Mail.Read, Mail.ReadWrite, Mail.Send)
              ├── Teams      (Chat.Create, Chat.ReadWrite, ChannelMessage.Send)
              ├── Calendar   (Calendars.Read, Calendars.ReadWrite)
              ├── SharePoint (Files.ReadWrite.All, Sites.ReadWrite.All)
              └── Directory  (User.Read, User.ReadBasic.All)
```

**All data stays local.** The MCP server runs on your machine. API calls go directly to Microsoft Graph. No data passes through Anthropic or any third party.

## Quick Start

### 1. Prerequisites

- Node.js v18+
- A Microsoft 365 account (work or school)
- An Azure Entra ID app registration with admin consent
- Claude Code CLI, Claude Desktop, or any MCP client

### 2. Clone and Install

```bash
git clone https://github.com/Doot-Workspaces/grounded-mcp.git
cd grounded-mcp/server
npm install
```

### 3. Configure Credentials

```bash
cp .env.example .env
chmod 600 .env
```

Edit `server/.env` with your Azure app credentials:

```env
OFFICE_CLIENT_ID=<your-azure-app-client-id>
OFFICE_CLIENT_SECRET=<your-azure-app-client-secret>
OFFICE_TENANT_ID=<your-azure-tenant-id>
OFFICE_REDIRECT_URI=http://localhost:3000/auth/callback
```

### 4. Authenticate

```bash
npm run auth-server
```

Open `http://localhost:3000/auth` in your browser, sign in with your Microsoft account, and approve permissions. Token is saved locally.

If your tenant blocks the consent screen, treat that as an organization-specific Entra policy issue, not a repo bug. The generic status is:

> Awaiting admin consent. Your Microsoft 365 tenant requires an administrator to approve one or more delegated Microsoft Graph permissions before authentication can complete.

### 5. Connect to Claude Code

Add to your project's `.mcp.json` or `~/.claude/settings.json`:

```json
{
  "mcpServers": {
    "office365": {
      "command": "sh",
      "args": ["-c", "cd /path/to/grounded-mcp/server && node index.js"]
    }
  }
}
```

Use one canonical server entry only. Do not keep multiple MCP entries pointing at older clones or copied installs of the repo.

### 6. Test

Restart Claude Code and ask: "List my recent emails" or "What's on my calendar today?"

### 7. Verify The Live Runtime After Any Restart

Do not assume a restart picked up the latest code. Verify the live process explicitly.

Runtime fingerprint:

```bash
cd /path/to/grounded-mcp/server
npm run runtime:info
```

Or ask the MCP server directly through the `system` tool with:

```json
{ "operation": "runtime_info" }
```

That returns the live version, git commit, branch, dirty-worktree flag, PID, start time, and entrypoint path.

### 8. Run The Post-Restart Live Formatting Smoke Test

If you care about Outlook reply formatting or Teams paragraph spacing, run the live smoke test after restart against yourself and a private chat:

```bash
cd /path/to/grounded-mcp/server
npm run smoke:live-format -- \
  --mailbox product@your-org.com \
  --outlook-to you@your-org.com \
  --teams-chat-id '19:your-chat-id@thread.v2'
```

What it does:

- sends exactly 4 live validation messages
- Outlook new mail
- Outlook reply on that same thread
- Teams new message in the target chat
- Teams follow-up reply-style message in the same chat
- fetches the exact sent/readback bodies
- prints a JSON report with the runtime fingerprint and formatting assertions

Use a self-addressed mailbox and a private test chat. Do not point this at live client or leadership threads.

## Setting Up the Azure Entra ID App

If you don't have an app registration yet:

1. Go to [Azure Portal](https://portal.azure.com) > **Azure Active Directory** > **App registrations** > **New registration**
2. Name: anything you like (e.g., "Claude Code MCP")
3. Redirect URI: `http://localhost:3000/auth/callback` (Web)
4. After creation, note the **Application (client) ID** and **Directory (tenant) ID**
5. Go to **Certificates & secrets** > **New client secret** — save the value
6. Go to **API permissions** > **Add a permission** > **Microsoft Graph** > **Delegated permissions**
7. Add the permissions listed in [SETUP-GUIDE.md](SETUP-GUIDE.md#api-permissions)
8. Click **Grant admin consent** (requires tenant admin)

## API Permissions Required

All delegated (acts as the signed-in user):

| Permission | Purpose |
|---|---|
| User.Read, User.ReadBasic.All | Directory lookups |
| Mail.Read, Mail.ReadWrite, Mail.Send | Email |
| Calendars.Read, Calendars.ReadWrite | Calendar |
| Chat.Create, Chat.ReadWrite | Teams chat |
| ChannelMessage.Read.All, ChannelMessage.Send | Teams channels |
| Files.ReadWrite.All | OneDrive/SharePoint |
| Sites.Read.All, Sites.ReadWrite.All | SharePoint sites |
| OnlineMeetings.Read | Meeting info |
| offline_access | Token refresh |

## Repository Structure

```
grounded-mcp/
├── .env.template         ← Credential template (safe to commit)
├── .gitignore            ← Protects credentials and tokens
├── README.md             ← This file
├── SETUP-GUIDE.md        ← Detailed setup walkthrough
├── SECURITY.md           ← Security policy, data flow, incident response
├── RULES.md              ← Recommended safety rules for AI email/messaging
├── CLAUDE.md             ← AI agent context (for Claude Code sessions)
├── hooks/                ← Safety hooks for Claude Code (credential guard, destructive command blocker, audit log)
│   ├── credential-guard.py   ← Blocks credential leaks in Write/Edit/Bash
│   ├── pre-tool-use.sh       ← Blocks destructive shell commands
│   ├── post-tool-use.sh      ← Daily audit log of all actions
│   └── README.md             ← Hook installation guide
└── server/               ← MCP server (based on office-365-mcp-server)
    ├── .env.example      ← Server credential template
    ├── index.js          ← Entry point
    ├── config.js         ← Server configuration
    ├── auth/             ← OAuth2 authentication
    ├── email/            ← Outlook email tools
    ├── calendar/         ← Calendar tools
    ├── teams/            ← Teams messaging tools
    ├── files/            ← SharePoint/OneDrive tools
    ├── directory/        ← User directory tools
    ├── contacts/         ← Contact tools
    ├── planner/          ← Planner tools
    ├── search/           ← Cross-service search
    ├── todo/             ← Microsoft To Do tools
    ├── groups/           ← M365 group tools
    ├── notifications/    ← Notification tools
    └── utils/            ← Shared utilities (Graph API, error handling)
```

## Safety Recommendations

See [RULES.md](RULES.md) for recommended safety practices when connecting AI tools to corporate email and messaging. Key principles:

- **Always review before sending** — AI should show full drafts before sending emails or messages
- **Explicit approval** — Require "yes" before any outbound communication
- **External recipient warnings** — Flag recipients outside your organization
- **No bulk operations** — One message at a time, never automated sending

## Troubleshooting

| Problem | Fix |
|---|---|
| "AADSTS65001: consent required" | Admin consent not granted — ask your tenant admin |
| "Awaiting admin consent" or a tenant-branded blocked page | Your organization's Entra tenant requires admin approval for the requested delegated permissions |
| Auth server won't start | Check port 3000 isn't in use: `lsof -i :3000` |
| Token expired | Re-run `npm run auth-server` and authenticate again |
| MCP server not in Claude Code | Check `.mcp.json` path, restart Claude Code |
| Restart worked but behavior still looks old | Run `npm run runtime:info` and confirm the live commit/path, then run `npm run smoke:live-format -- ...` against a private test target |
| "invalid_client" error | Client secret may have expired — rotate in Azure Portal |
| Wrong redirect URI | Must match exactly: `http://localhost:3000/auth/callback` |

## Contributing

Contributions welcome. This builds on top of [hvkshetry/office-365-mcp-server](https://github.com/hvkshetry/office-365-mcp-server) (MIT license).

Areas for improvement:
- Better error messages and retry logic
- Batch operations for Graph API
- More complete Teams meeting support
- Timezone handling improvements
- Additional safety hooks and approval gates

## License

MIT — see [server/LICENSE](server/LICENSE)

## Credits

- MCP server: [hvkshetry/office-365-mcp-server](https://github.com/hvkshetry/office-365-mcp-server)
- Safety hooks, format discipline, runtime verification, and docs: [Doot-Workspaces](https://github.com/Doot-Workspaces)
