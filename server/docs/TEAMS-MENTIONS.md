# Teams @mentions — How to actually tag someone

> Platform-fact reference for any MCP consumer sending Teams messages via `teams_chat.send_message` / `update_message`.

## The trap

**Bolding a name is not a mention.**

```html
<!-- Looks like a tag. Is not a tag. -->
Hi <b>Ankit</b>, please run bench migrate.
```

The message renders bold text, but Ankit receives no Teams notification, no "@" ping indicator, and the recipient's client cannot resolve a user identifier from the bold text. If the task says "tag X" or "@mention X" and the message ships without a `mentions` array, the action silently fails — the sender believes they've pinged, the recipient sees nothing.

This exact misfire happened on 2026-04-17 (Akamai-Sattva group) and is the reason this doc exists.

## The working pattern (confirmed live 2026-04-17)

Two parts, both required, IDs aligned:

1. **`<at id="N">Display Name</at>` tag inside the HTML `content`.** This is what renders the blue "@" ping indicator.
2. **`mentions` array entry** carrying the AAD user id. This is what routes the notification.

```javascript
// teams_chat.send_message arguments
{
  operation: 'send_message',
  chatId: '19:<chat-guid>@thread.v2',
  content: '<div>Hi <at id="0">Vikash Kumar</at>, <at id="1">Ankit Jangir</at> — PR #3 is up.</div>',
  mentions: [
    {
      id: 0,
      mentionText: 'Vikash Kumar',
      mentioned: {
        user: {
          id: '9abb6ee4-20eb-4137-b168-dbd148c1f735',  // AAD GUID
          displayName: 'Vikash Kumar',
          userIdentityType: 'aadUser'
        }
      }
    },
    {
      id: 1,
      mentionText: 'Ankit Jangir',
      mentioned: {
        user: {
          id: 'a214793e-2a4b-4c7c-a1d2-221a3f6e9c07',
          displayName: 'Ankit Jangir',
          userIdentityType: 'aadUser'
        }
      }
    }
  ]
}
```

The `id` field on every `<at>` tag must match the `id` of the corresponding mentions array entry. Any mismatch → the `<at>` tag renders as plain text with no ping.

## Looking up AAD IDs

Use the `directory.lookup_user` tool:

```javascript
{ operation: 'lookup_user', email: 'ankit.jangir@dhwaniris.com' }
// → returns { Name, Email, ID: 'a214793e-...' }
```

The returned `ID` is the AAD GUID that goes in `mentioned.user.id`. Cache frequently-used AAD IDs in your agent's memory once retrieved — they are stable and do not rotate with password changes.

## Edit-vs-notify rule (important)

`update_message` **preserves** `<at>` tags and mentions IF the `mentions` array is re-passed on the update call. The MCP layer handles this correctly (see `teams_chat.js` `updateChatMessage`).

But — **`update_message` never re-triggers Teams notifications.** The recipient's ping only fires on the original `send_message`.

**Consequence:** if the first send was missing `mentions` and the recipient did not get notified, a corrective `update_message` will fix the historical record but will not re-ping. The correct recovery pattern is:

1. `update_message` on the original (keeps chat history clean with proper identifiers).
2. `send_message` a short fresh follow-up with mentions — this is what actually triggers the notification.

## Pre-send checklist

Before any `teams_chat.send_message` that names a person as a recipient:

- [ ] AAD ID looked up for every named recipient via `directory.lookup_user`.
- [ ] Every named recipient has an `<at id="N">Display Name</at>` tag in the HTML.
- [ ] `mentions` array has a matching `id` + `mentioned.user.id` for every `<at>` tag.
- [ ] If the intent is readability only and not tagging, bolding (`<b>Name</b>`) is fine — but do not describe it as a tag in surrounding prose.

## Why this lives here

Per grounded-mcp's separation-of-purpose rules (see `CLAUDE.md`):

> **Belongs in grounded-mcp:** Platform facts (markdown warning, `<at>` preservation, calendar routing)

This doc codifies a Microsoft Graph / Teams platform fact that every MCP consumer needs, regardless of agent voice or organization. Agent-specific guidance (e.g., when Prody is allowed to @mention without sign-off) lives in the consuming agent's playbook, not here.

## Related

- Code: `server/teams/consolidated/teams_chat.js` — `sendChatMessage` / `updateChatMessage`
- Schema: `server/teams/consolidated/index.js` — `mentions` parameter description
- Tests: `server/tests/teams-chat-mentions.test.js`
