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
    callGraphAPI.mockImplementation((token, method, path) => {
      if (method === 'GET' && path.includes('$select=attendees')) {
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

  it('overwrites the whole roster under attendeeMode replace, without a read', async () => {
    await calendarTool.handler({
      operation: 'update',
      eventId,
      attendees: ['khwahish.sharma@dhwaniris.com'],
      attendeeMode: 'replace'
    });

    const sent = patchBody().attendees.map(a => a.emailAddress.address);
    expect(sent).toEqual(['khwahish.sharma@dhwaniris.com']);
    expect(callGraphAPI.mock.calls.some(c => c[1] === 'GET')).toBe(false);
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
