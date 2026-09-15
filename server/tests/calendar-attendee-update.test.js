const { describe, it, expect, beforeEach } = require('@jest/globals');
const { calendarTools } = require('../calendar');
const { ensureAuthenticated } = require('../auth');
const { callGraphAPI } = require('../utils/graph-api');

jest.mock('../auth', () => ({
  ensureAuthenticated: jest.fn()
}));
jest.mock('../utils/graph-api');

describe('calendar update — attendee merge', () => {
  const mockAccessToken = 'mock-access-token';
  const eventId = 'mock-event-id';
  let calendarTool;

  // A roster that mirrors the real failure case: people already on a recurring
  // series, one of them having already accepted.
  const existingAttendees = [
    {
      type: 'Required',
      status: { response: 'accepted', time: '2026-09-01T10:00:00Z' },
      emailAddress: { address: 'nihaan.mohammed@dhwaniris.com', name: 'Nihaan Mohammed' }
    },
    {
      type: 'Optional',
      status: { response: 'none', time: '0001-01-01T00:00:00Z' },
      emailAddress: { address: 'akshat.verma@dhwaniris.com', name: 'Akshat Verma' }
    }
  ];

  const patchBody = () => {
    const patchCall = callGraphAPI.mock.calls.find(c => c[1] === 'PATCH');
    return patchCall && patchCall[3];
  };

  beforeEach(() => {
    jest.clearAllMocks();
    ensureAuthenticated.mockResolvedValue(mockAccessToken);
    calendarTool = calendarTools.find(tool => tool.name === 'calendar');
    // Match on the method alone. Matching on the path shape here is what let
    // the "?$select=attendees" bug through: the mock was written around the
    // broken URL, so it answered a request Graph rejects in production.
    // Default: a standalone event, so the recurrence probe finds no series.
    callGraphAPI.mockImplementation((token, method, path, body, query) => {
      if (method === 'GET') {
        if (query && query.$select === 'type,seriesMasterId') {
          return Promise.resolve({ type: 'singleInstance' });
        }
        return Promise.resolve({ attendees: existingAttendees });
      }
      return Promise.resolve({ id: eventId });
    });
  });

  it('appends a new attendee without dropping the existing roster', async () => {
    await calendarTool.handler({
      operation: 'update',
      eventId,
      attendees: ['khwahish.sharma@dhwaniris.com']
    });

    const sent = patchBody().attendees.map(a => a.emailAddress.address);
    expect(sent).toEqual([
      'nihaan.mohammed@dhwaniris.com',
      'akshat.verma@dhwaniris.com',
      'khwahish.sharma@dhwaniris.com'
    ]);
  });

  describe('recurring series', () => {
    const masterId = 'series-master-id';

    beforeEach(() => {
      callGraphAPI.mockImplementation((token, method, path, body, query) => {
        if (method === 'GET') {
          if (query && query.$select === 'type,seriesMasterId') {
            return Promise.resolve({ type: 'occurrence', seriesMasterId: masterId });
          }
          return Promise.resolve({ attendees: existingAttendees });
        }
        return Promise.resolve({ id: masterId });
      });
    });

    it('patches the series master, not the occurrence it was given', async () => {
      // The whole point. Patching the occurrence detaches that one date as a
      // series exception and leaves every other date unchanged, so the person
      // ends up invited to a single day.
      await calendarTool.handler({
        operation: 'update',
        eventId,
        attendees: ['khwahish.sharma@dhwaniris.com']
      });

      const patchCall = callGraphAPI.mock.calls.find(c => c[1] === 'PATCH');
      expect(patchCall[2]).toBe(`me/events/${masterId}`);
      expect(patchCall[2]).not.toContain(eventId);
    });

    it('reads the roster from the master too, so the merge sees the series list', async () => {
      await calendarTool.handler({
        operation: 'update',
        eventId,
        attendees: ['khwahish.sharma@dhwaniris.com']
      });

      const rosterRead = callGraphAPI.mock.calls.find(
        c => c[1] === 'GET' && c[4] && c[4].$select === 'attendees'
      );
      expect(rosterRead[2]).toBe(`me/events/${masterId}`);
    });

    it('says the series was updated, not just the event', async () => {
      const result = await calendarTool.handler({
        operation: 'update',
        eventId,
        attendees: ['khwahish.sharma@dhwaniris.com']
      });

      expect(result.content[0].text).toMatch(/series/i);
    });

    it('stays on the single date when applyToOccurrence is set', async () => {
      await calendarTool.handler({
        operation: 'update',
        eventId,
        attendees: ['khwahish.sharma@dhwaniris.com'],
        applyToOccurrence: true
      });

      const patchCall = callGraphAPI.mock.calls.find(c => c[1] === 'PATCH');
      expect(patchCall[2]).toBe(`me/events/${eventId}`);
    });

    it('refuses rather than guessing when the master cannot be resolved', async () => {
      callGraphAPI.mockImplementation((token, method, path, body, query) => {
        if (method === 'GET' && query && query.$select === 'type,seriesMasterId') {
          return Promise.resolve({ type: 'occurrence' });
        }
        return Promise.resolve({ attendees: existingAttendees });
      });

      const result = await calendarTool.handler({
        operation: 'update',
        eventId,
        attendees: ['khwahish.sharma@dhwaniris.com']
      });

      expect(result.content[0].text).toMatch(/seriesMasterId/);
      expect(callGraphAPI.mock.calls.some(c => c[1] === 'PATCH')).toBe(false);
    });
  });

  it('reads the roster with a clean event path and $select as a query param', async () => {
    // Regression guard. An occurrence id of a recurring series carries its own
    // encoding; appending "?$select=attendees" to it makes Graph reject the id
    // outright ("The Id is invalid"), which is exactly how this failed live on
    // a real recurring event. The read must look like getCalendarEvent's.
    await calendarTool.handler({
      operation: 'update',
      eventId,
      attendees: ['khwahish.sharma@dhwaniris.com']
    });

    const readCall = callGraphAPI.mock.calls.find(
      c => c[1] === 'GET' && c[4] && c[4].$select === 'attendees'
    );
    expect(readCall[2]).toBe(`me/events/${eventId}`);
    expect(readCall[2]).not.toContain('?');
    expect(readCall[4]).toEqual({ $select: 'attendees' });
  });

  it('preserves an existing attendee RSVP status through the merge', async () => {
    await calendarTool.handler({
      operation: 'update',
      eventId,
      attendees: ['khwahish.sharma@dhwaniris.com']
    });

    const nihaan = patchBody().attendees.find(
      a => a.emailAddress.address === 'nihaan.mohammed@dhwaniris.com'
    );
    expect(nihaan.status.response).toBe('accepted');
    expect(nihaan.type).toBe('Required');
  });

  it('does not duplicate an attendee who is already invited, and keeps their type', async () => {
    await calendarTool.handler({
      operation: 'update',
      eventId,
      attendees: ['Akshat.Verma@dhwaniris.com'] // different casing on purpose
    });

    const sent = patchBody().attendees;
    expect(sent).toHaveLength(2);
    const akshat = sent.find(
      a => a.emailAddress.address.toLowerCase() === 'akshat.verma@dhwaniris.com'
    );
    expect(akshat.type).toBe('Optional');
  });

  it('removes only the named attendee under attendeeMode remove', async () => {
    await calendarTool.handler({
      operation: 'update',
      eventId,
      attendees: ['akshat.verma@dhwaniris.com'],
      attendeeMode: 'remove'
    });

    const sent = patchBody().attendees.map(a => a.emailAddress.address);
    expect(sent).toEqual(['nihaan.mohammed@dhwaniris.com']);
  });

  it('overwrites the whole roster under attendeeMode replace, without reading it', async () => {
    await calendarTool.handler({
      operation: 'update',
      eventId,
      attendees: ['khwahish.sharma@dhwaniris.com'],
      attendeeMode: 'replace'
    });

    const sent = patchBody().attendees.map(a => a.emailAddress.address);
    expect(sent).toEqual(['khwahish.sharma@dhwaniris.com']);
    // replace skips the ROSTER read by definition. The recurrence probe still
    // runs, because replace must land on the series like every other mode.
    const rosterRead = callGraphAPI.mock.calls.find(
      c => c[1] === 'GET' && c[4] && c[4].$select === 'attendees'
    );
    expect(rosterRead).toBeUndefined();
  });

  it('rejects an unknown attendeeMode without calling Graph', async () => {
    const result = await calendarTool.handler({
      operation: 'update',
      eventId,
      attendees: ['khwahish.sharma@dhwaniris.com'],
      attendeeMode: 'purge'
    });

    expect(result.content[0].text).toMatch(/Invalid attendeeMode/);
    expect(callGraphAPI).not.toHaveBeenCalled();
  });

  it('rejects a non-array attendees value without calling Graph', async () => {
    const result = await calendarTool.handler({
      operation: 'update',
      eventId,
      attendees: 'khwahish.sharma@dhwaniris.com'
    });

    expect(result.content[0].text).toMatch(/must be an array/);
    expect(callGraphAPI).not.toHaveBeenCalled();
  });

  it('still updates scalar fields alongside an attendee change', async () => {
    await calendarTool.handler({
      operation: 'update',
      eventId,
      subject: 'mGrant Standup',
      attendees: ['khwahish.sharma@dhwaniris.com']
    });

    const body = patchBody();
    expect(body.subject).toBe('mGrant Standup');
    expect(body.attendees).toHaveLength(3);
  });
});
