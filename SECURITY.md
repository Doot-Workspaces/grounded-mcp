# Security Policy — MCP M365 Connector

## Classification

This repository provides configuration for connecting AI CLI tools to Microsoft 365 services. It handles OAuth2 credentials and accesses corporate email, Teams, Calendar, and SharePoint.

**Data sensitivity: HIGH** — corporate communications, calendar, and documents.

---

## Credential Management

### What MUST be stored in .env (never committed)
- Azure Client ID
- Azure Tenant ID
- Azure Client Secret
- OAuth2 refresh tokens
- User email addresses

### What is committed (safe)
- `.env.template` / `.env.example` (empty placeholders only)
- `.gitignore` (protects credentials)
- Documentation files (README, SETUP-GUIDE, etc.)
- MCP server source code (MIT licensed)

### Rules
- `.env` files must be gitignored and have `chmod 600` (owner-only read/write)
- Tokens are stored locally on disk, never transmitted to third parties
- Client secrets should be rotated every 12 months
- If a credential is accidentally committed, rotate it immediately in Azure Portal

---

## Authentication Flow

```
User's browser → Microsoft login page → Redirect to localhost:3000
                                          ↓
                               Token saved to local disk
                                          ↓
                               MCP server reads token for API calls
```

- All auth happens locally — no external servers involved
- Redirect URI is `http://localhost:3000/auth/callback` (local only)
- Tokens are stored in the user's home directory
- No credentials are sent to Anthropic, Claude, or any AI service

---

## Data Flow

```
AI CLI Tool → MCP Server (local process) → Microsoft Graph API → M365 Data
                                                                      ↓
                                                           Response to local CLI
```

- MCP server runs as a local Node.js process on the user's machine
- All API calls go directly from the user's machine to Microsoft Graph
- No data passes through Anthropic's servers or any third party
- No email content, Teams messages, or calendar data is stored by the MCP server
- The AI tool sees API responses in its context window (ephemeral, not persisted by the MCP server)

---

## Recommended Sending Safeguards

### Email
- AI MUST show the full draft (To, CC, BCC, Subject, Body) before sending
- User MUST explicitly approve sending
- No automated/scheduled sending — every send is human-triggered
- External recipients (outside your domain) should trigger an additional warning

### Teams Messages
- Client-facing channels: same approval gate as email
- Internal channels: lower friction is acceptable
- No bulk messaging

### Calendar
- Read access: unrestricted
- Create/update events: allowed
- Delete events: requires confirmation

### SharePoint
- Upload: allowed
- Delete: requires confirmation
- No bulk delete operations without explicit approval

---

## Incident Response

### If credentials are leaked
1. Immediately rotate the Client Secret in Azure Portal
2. Revoke all active tokens: Azure Portal > App Registrations > Your App > Certificates & Secrets > delete old secret
3. Check Azure sign-in logs for unauthorized access
4. Update `.env` files locally with new credentials

### If unauthorized access is detected
1. Disable the app: Azure Portal > Enterprise Applications > Your App > Properties > Enabled = No
2. Review sign-in logs
3. Notify your IT admin
4. Re-enable only after investigation is complete

---

## Audit Trail

- All email sends are logged by Microsoft 365 (Sent Items folder)
- All Teams messages are logged by Microsoft 365 (channel/chat history)
- AI CLI session transcripts record all tool calls (stored locally)
- All actions are attributable to the signed-in Microsoft account

---

## Compliance Notes

- This setup uses **delegated permissions** (acts as the signed-in user, not an app-level daemon)
- All actions are attributable to the user's Microsoft account in audit logs
- Admin consent is required for the Entra ID tenant
- The app does NOT have application-level permissions (cannot act without a user session)

---

## Review Schedule

| What | When |
|---|---|
| Check token expiry | Monthly |
| Review API permissions | Quarterly — remove any no longer needed |
| Rotate Client Secret | Annually |
| Full review | On personnel change |
