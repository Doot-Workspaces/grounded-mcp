# Setup Guide — Grounded MCP

> Step-by-step guide to connect your AI CLI tool to Microsoft 365 via MCP.

---

## Prerequisites

- **Node.js** v18+ installed
- **Claude Code CLI**, **Claude Desktop**, or any MCP-compatible client
- **Azure credentials** from an Entra ID app registration (see below)
- **Admin consent** granted on your Entra ID tenant

---

## Architecture

```
Your AI CLI Tool (Claude Code, Claude Desktop, etc.)
  └── MCP Server (runs locally on your machine)
        └── Microsoft Graph API (OAuth2 delegated flow via Entra ID)
              ├── Outlook    (Mail.Read, Mail.ReadWrite, Mail.Send)
              ├── Teams      (Chat.Create, Chat.ReadWrite, ChannelMessage.Send)
              ├── Calendar   (Calendars.Read, Calendars.ReadWrite)
              ├── SharePoint (Files.ReadWrite.All, Sites.ReadWrite.All)
              └── Other      (User.Read, User.ReadBasic.All, OnlineMeetings.Read, offline_access)
```

**Data flow:** AI CLI → local MCP server → Microsoft Graph API → M365 data → back to CLI. No data passes through Anthropic's or any third-party servers.

---

## Step 1: Clone and Install

```bash
git clone https://github.com/Doot-Workspaces/grounded-mcp.git
cd grounded-mcp/server
npm install
```

## Step 2: Create the Azure Entra ID App (if you don't have one)

1. Go to [Azure Portal](https://portal.azure.com) > **Azure Active Directory** > **App registrations** > **New registration**
2. **Name:** Whatever you like (e.g., "Claude Code MCP", "AI M365 Connector")
3. **Supported account types:** "Accounts in this organizational directory only" (single tenant)
4. **Redirect URI:** Platform = Web, URI = `http://localhost:3000/auth/callback`
5. Click **Register**

After registration:
- Note the **Application (client) ID** — this is your `OFFICE_CLIENT_ID`
- Note the **Directory (tenant) ID** — this is your `OFFICE_TENANT_ID`
- Go to **Certificates & secrets** > **New client secret** > copy the **Value** — this is your `OFFICE_CLIENT_SECRET`

## Step 3: Add API Permissions

In your app registration, go to **API permissions** > **Add a permission** > **Microsoft Graph** > **Delegated permissions**.

Add these 17 permissions:

| Permission | Purpose |
|---|---|
| Chat.Create | Create Teams chats |
| Chat.ReadWrite | Read/write Teams chats |
| User.Read | Read own profile |
| User.ReadBasic.All | Read all user profiles |
| Mail.Read | Read emails |
| Mail.ReadWrite | Draft and manage emails |
| Mail.Send | Send emails |
| Calendars.Read | Read calendar |
| Calendars.ReadWrite | Create/update calendar events |
| Files.ReadWrite.All | SharePoint/OneDrive files |
| Sites.Read.All | Read SharePoint sites |
| Sites.ReadWrite.All | Write to SharePoint sites |
| OnlineMeetings.Read | Read meeting details |
| ChannelMessage.Read.All | Read Teams channel messages |
| ChannelMessage.Send | Send Teams channel messages |
| offline_access | Token refresh (keeps you logged in) |

Then click **Grant admin consent for [your tenant]** (requires tenant admin role).

## Step 4: Configure Server Credentials

```bash
cd server
cp .env.example .env
chmod 600 .env
```

Edit `server/.env`:

```env
OFFICE_CLIENT_ID=<your-app-client-id>
OFFICE_CLIENT_SECRET=<your-client-secret-value>
OFFICE_TENANT_ID=<your-tenant-id>
OFFICE_REDIRECT_URI=http://localhost:3000/auth/callback
```

Optionally, create a root `.env` too:

```bash
cd ..
cp .env.template .env
chmod 600 .env
```

## Step 5: Authenticate with Microsoft

```bash
cd server
npm run auth-server
```

1. Open `http://localhost:3000/auth` in your browser
2. Sign in with your Microsoft work/school account
3. Accept the permissions prompt
4. Token is saved locally (usually `~/.office-mcp-tokens.json`)
5. Close browser and stop the auth server (Ctrl+C)

If Microsoft shows a blocked or pending-consent page, use generic wording in docs and support notes:

> Awaiting admin consent. This Microsoft 365 tenant requires an administrator to approve the requested delegated Microsoft Graph permissions before authentication can complete.

## Step 6: Configure Your MCP Client

### Claude Code CLI

Create `.mcp.json` in any project directory:

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

Or add to `~/.claude/settings.json` for global access.

Keep exactly one canonical MCP entry for this server. If you leave older clones or copied installs in your client config, a restart can silently bring back stale code.

### Claude Desktop

Add to your Claude Desktop MCP settings:

```json
{
  "mcpServers": {
    "office365": {
      "command": "node",
      "args": ["/path/to/grounded-mcp/server/index.js"],
      "cwd": "/path/to/grounded-mcp/server"
    }
  }
}
```

## Step 7: Test

Restart your MCP client. Try:
- "List my recent emails"
- "What's on my calendar today?"
- "Search for user John in the directory"

## Step 8: Verify The Live Runtime After Restart

From `grounded-mcp/server`:

```bash
npm run runtime:info
```

Or through the `system` tool with:

```json
{ "operation": "runtime_info" }
```

This gives you the live version, git commit, branch, dirty-worktree flag, PID, start time, and entrypoint path.

## Step 9: Run The Live Formatting Smoke Test When Formatting Matters

From `grounded-mcp/server`:

```bash
npm run smoke:live-format -- \
  --mailbox you@your-org.com \
  --outlook-to you@your-org.com \
  --teams-chat-id '19:your-chat-id@thread.v2'
```

Use a self-addressed mailbox and a private chat only. The script sends 4 live validation messages and fetches the exact sent/readback bodies so you can verify Outlook reply formatting and Teams paragraph spacing after restart.

---

## MCP Server Tools (15 tools)

| Tool | What it does |
|---|---|
| `mail` | List, read, send, reply, draft, search, move, folders, rules, categories |
| `calendar` | List, create, get, update, delete calendar events |
| `contacts` | Contact management |
| `directory` | User profiles, managers, direct reports, presence, search |
| `files` | SharePoint/OneDrive file operations |
| `groups` | Microsoft 365 group management |
| `planner` | Planner task management |
| `search` | Search across M365 |
| `teams_channel` | Teams channel messaging |
| `teams_chat` | Teams chat messaging |
| `teams_meeting` | Teams meeting management |
| `todo` | Microsoft To Do task management |
| `notifications` | Notification management |
| `system` | System/health checks |

---

## Troubleshooting

| Problem | Fix |
|---|---|
| "AADSTS65001: consent required" | Admin consent not granted — ask your tenant admin to approve in Azure Portal |
| "Awaiting admin consent" or a tenant-specific blocked page | The tenant requires admin approval for one or more delegated permissions; have an Entra admin grant consent and retry |
| Auth server won't start | Check port 3000 isn't in use: `lsof -i :3000` (macOS/Linux) or `netstat -an \| findstr :3000` (Windows) |
| Token expired | Re-run Step 5 (authenticate again) |
| MCP server not showing in client | Check config path, restart your MCP client |
| Server restarted but behavior still looks old | Run `npm run runtime:info` to confirm the live commit/path, then run `npm run smoke:live-format -- ...` against a private test target |
| "invalid_client" error | Client secret may have expired — rotate in Azure Portal |
| Wrong redirect URI error | Must match exactly: `http://localhost:3000/auth/callback` |

---

## Credential Rotation Schedule

| What | When |
|---|---|
| Check token expiry | Monthly |
| Review API permissions | Quarterly (remove unused ones) |
| Rotate Client Secret | Annually |
| Revoke & rotate everything | On personnel change |
