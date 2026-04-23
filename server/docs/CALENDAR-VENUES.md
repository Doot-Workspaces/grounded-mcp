# Booking venues — How to actually reserve a room

> Platform-fact reference for any MCP consumer creating physical in-person meetings via `calendar.create`.

## The trap

**Setting `location` does not reserve a room.**

```javascript
// Looks like a booking. Is not a booking.
{
  operation: 'create',
  subject: 'Design review',
  start: '2026-04-27T14:00:00+05:30',
  end:   '2026-04-27T15:15:00+05:30',
  location: 'LAMP Room',          // ← display string only
  attendees: ['alice@org.com', 'bob@org.com']
}
```

The invite goes out, the event shows "LAMP Room" in the Outlook UI, and attendees see a location string. But the physical room resource does not receive the invite, the room mailbox's calendar never gets blocked, and anyone else can book the same room for the same slot. The `location` field is free-text metadata. It books nothing.

This misfire happened on 2026-04-23 (Akshat onboarding meeting) and is the reason this doc exists.

## The working pattern

Two parts, both required:

1. **Add the room's resource mailbox as an attendee.** This is what actually reserves the room — Exchange routes the invite to the room mailbox, which auto-accepts or auto-declines based on free/busy.
2. **Set `location` to a human-readable label** so the UI still shows a clean name.

```javascript
{
  operation: 'create',
  subject: 'Design review',
  start: '2026-04-27T14:00:00+05:30',
  end:   '2026-04-27T15:15:00+05:30',
  location: 'LAMP Room',                          // display label
  attendees: [
    'alice@org.com',
    'bob@org.com',
    '4LAMPground@dhwaniris.com'                   // ← the actual reservation
  ],
  isOnlineMeeting: false
}
```

The room resource address is an ordinary Exchange mailbox — it just happens to be configured with `AutomateProcessing: AutoAccept` on the server side. Any MCP consumer can pass it like a human attendee; `buildAttendees` currently defaults every attendee to `type: 'Required'`, which Exchange handles correctly for room resources (the auto-response fires regardless of whether the attendee type is `Required` or `Resource`).

## Discovering a room's resource email

Room resource emails are organization-specific (e.g., `4LAMPground@dhwaniris.com`, `conf-room-a@example.com`). Never guess them — the wrong guess silently sends to no mailbox.

Two reliable discovery paths:

**1. Via a prior event whose `location` field matches the room**

```javascript
// Step 1: list recent events
calendar({ operation: 'list', startDateTime: '...', endDateTime: '...' })

// Step 2: find one with the room name in its `location` string

// Step 3: fetch the full event
calendar({ operation: 'get', eventId: '<found-id>' })

// The room's resource email appears in `attendees` alongside human attendees.
```

**2. Via directory lookup** (if `directory.find_rooms` or equivalent is exposed in your MCP build — check `server/directory/`).

Agent-side note: once resolved, cache verified room emails in agent memory. Room addresses are stable.

## Auto-response timing

Room mailboxes reply **within 5–15 seconds** of the create call — not synchronously with the create response. Expect:

1. `calendar.create` returns success with the event ID (this does not mean the room accepted).
2. Seconds later, an `Accepted: <subject>` or `Declined: <subject>` mail arrives from the room's mailbox into the organizer's inbox.
3. The event's `attendees` list on subsequent `get` calls may or may not show the room's response status depending on which Graph projection the tool fetches.

**Ground truth is the mail response, not the create response.** To verify a booking, `mail.search` for the room's address or the event subject immediately after creating:

```javascript
mail({ operation: 'search', query: '<room-address> <subject>', maxResults: 5 })
```

## When a room declines

If the room is busy, the room mailbox sends `Declined: <subject>` and the event remains on the organizer's calendar with the room attendee in a "declined" state. Human attendees still receive the original invite — they are now looking at a meeting with no real venue.

**Recovery pattern — delete and recreate, do not update:**

```javascript
// 1. Delete the original (sends cancellations to all attendees)
calendar({ operation: 'delete', eventId: '<id>', sendCancellations: true })

// 2. Create a fresh event with a different room resource
calendar({ operation: 'create', /* ... */, attendees: [..., '<new-room>@org.com'] })
```

Why not `update`? The calendar `update` operation silently drops the `attendees` array in the current MCP build — a known regression tracked separately. Even without that bug, swapping an attendee list via update is less reliable than a clean delete+recreate for room swaps.

One clean tradeoff: attendees see a cancel + new invite pair. This is accepted cost for guaranteeing the correct room is actually reserved.

## `findMeetingTimes` caveat

Including a room resource in the `attendees` array of a `calendar.find` (`findMeetingTimes`) call has produced **unreliable output** in observed runs — the API has returned "no availability for weeks" responses even when the room had open slots, and has returned identical suggestion lists across different rooms. This appears to be a Graph-side quirk around how resource free/busy joins with user free/busy in the suggestion engine, not a bug in this MCP.

**Practical rule:** do not rely on `find` with rooms as a pre-flight availability probe. The authoritative test is:

1. `calendar.create` with the room as an attendee.
2. Watch for the room's accept/decline mail within 15 seconds.
3. If declined, delete and retry with a different room.

Use `find` freely for human attendee availability — it works well there.

## Pre-create checklist

Before any `calendar.create` for an in-person meeting:

- [ ] Room's resource email is **in `attendees`**, not just in `location`.
- [ ] Room email was resolved from a real event or directory call — not guessed.
- [ ] `isOnlineMeeting: false` is set (unless hybrid is intentional).
- [ ] `location` string is the human-readable room name for UI clarity.
- [ ] After create, poll the organizer's inbox for `Accepted:` or `Declined:` from the room.
- [ ] If declined, delete and recreate with a different room — do not `update` to swap.

## Why this lives here

Per grounded-mcp's separation-of-purpose rules (see `CLAUDE.md`):

> **Belongs in grounded-mcp:** Platform facts (markdown warning, `<at>` preservation, calendar routing)

Room resources, `AutomateProcessing: AutoAccept`, the `location`-vs-attendee distinction, and the delete+recreate swap pattern are all Microsoft Graph / Exchange platform behaviors. They apply to every MCP consumer that books venues, regardless of agent voice or organization. Organization-specific room registries (e.g., "LAMP Room maps to `4LAMPground@dhwaniris.com`") live in the consuming agent's memory, not here.

## Related

- Code: `server/calendar/index.js` — `createEvent`, `buildAttendees`, `findMeetingTimes`
- Schema: `server/calendar/index.js` — `attendees` parameter description (line ~547)
- Sibling doc: `server/docs/TEAMS-MENTIONS.md` — same pattern, different domain (Teams @mentions)
