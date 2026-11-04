/**
 * Teams "powers": mention validation and resolution, preview_message,
 * thread_state, channel mentions, and findMeetingTimes conflict surfacing.
 */

const { describe, it, expect, beforeEach } = require('@jest/globals');

jest.mock('../auth', () => ({
  ensureAuthenticated: jest.fn().mockResolvedValue('mock-access-token')
}));
jest.mock('../utils/graph-api', () => ({
  callGraphAPI: jest.fn()
}));

const handleTeamsChat = require('../teams/consolidated/teams_chat');
const handleTeamsChannel = require('../teams/consolidated/teams_channel');
const { calendarTools } = require('../calendar');
const { inspectMentions } = require('../utils/teams-mentions');
const { analyzeThread } = require('../utils/teams-thread');
const { callGraphAPI } = require('../utils/graph-api');

const GUID = '11111111-2222-3333-4444-555555555555';
const SELF = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
const user = (id, name = 'Person One') => ({ id: 0, mentionText: name, mentioned: { user: { id, displayName: name, userIdentityType: 'aadUser' } } });
const text = r => r.content[0].text;

let sent;
beforeEach(() => {
  sent = [];
  jest.clearAllMocks();
  callGraphAPI.mockImplementation(async (token, method, endpoint, body) => {
    if (method === 'GET' && endpoint.startsWith('users/')) return { id: GUID, displayName: 'Person One' };
    if (method === 'GET' && endpoint === 'me') return { id: SELF, displayName: 'Prody' };
    sent.push({ method, endpoint, body });
    return { id: 'msg-1' };
  });
});

describe('inspectMentions', () => {
  it('accepts a matching tag and GUID entry', () => {
    expect(inspectMentions('<div><at id="0">Person One</at> hi</div>', [user(GUID)]).errors).toEqual([]);
  });
  it('rejects a tag with no entry and an entry with no tag', () => {
    expect(inspectMentions('<at id="0">A</at>', []).errors.join()).toMatch(/no matching mentions entry/);
    expect(inspectMentions('hello', [user(GUID)]).errors.join()).toMatch(/no <at id="0">/);
  });
  it('rejects an email in mentioned.user.id (the 2026-07-20 silent no-ping)', () => {
    expect(inspectMentions('<at id="0">A</at>', [user('person.one@example.org')]).errors.join()).toMatch(/AAD GUID/);
  });
  it('rejects mentions JSON pasted into the content', () => {
    expect(inspectMentions('hi {"mentions": []}', []).errors.join()).toMatch(/top-level `mentions`/);
  });
  it('warns on a plain @Name but not on an email address', () => {
    expect(inspectMentions('<div>ping @Person please</div>', []).warnings.join()).toMatch(/plain-text/);
    expect(inspectMentions('<div>mail person.one@example.org</div>', []).warnings).toEqual([]);
  });
});

describe('send_message mention preparation', () => {
  it('resolves an email id to the AAD GUID before sending', async () => {
    await handleTeamsChat({ operation: 'send_message', chatId: 'c1', content: '<at id="0">Person One</at> hi', mentions: [user('person.one@example.org')] });
    const post = sent.find(r => r.method === 'POST');
    expect(post.body.mentions[0].mentioned.user.id).toBe(GUID);
  });
  it('sends nothing when a tag has no entry', async () => {
    const r = await handleTeamsChat({ operation: 'send_message', chatId: 'c1', content: '<at id="0">Person</at> hi' });
    expect(text(r)).toMatch(/Mention check failed, nothing was sent/);
    expect(sent).toHaveLength(0);
  });
});

describe('channel messages carry mentions', () => {
  it('create_message passes mentions through (it used to drop them)', async () => {
    await handleTeamsChannel({ operation: 'create_message', teamId: 't', channelId: 'ch', content: '<at id="0">Person One</at> hi', mentions: [user(GUID)] });
    expect(sent[0].body.mentions).toHaveLength(1);
  });
  it('reply_to_message rejects a mismatched mention', async () => {
    const r = await handleTeamsChannel({ operation: 'reply_to_message', teamId: 't', channelId: 'ch', messageId: 'm', content: 'hi', mentions: [user(GUID)] });
    expect(text(r)).toMatch(/Mention check failed/);
    expect(sent).toHaveLength(0);
  });
});

describe('preview_message', () => {
  it('sends nothing and reports verdict, plain text and HTML', async () => {
    const r = await handleTeamsChat({ operation: 'preview_message', content: '<at id="0">Person One</at> hi', mentions: [user('person.one@example.org')] });
    expect(sent).toHaveLength(0);
    expect(text(r)).toMatch(/Verdict: OK TO SEND/);
    expect(text(r)).toMatch(/Mentions that would ping: 1/);
  });
  it('flags markdown and a mention mismatch', async () => {
    const r = await handleTeamsChat({ operation: 'preview_message', content: '**bold** <at id="3">X</at>' });
    expect(text(r)).toMatch(/WOULD FAIL/);
    expect(text(r)).toMatch(/Markdown detected/);
  });
});

describe('thread_state / analyzeThread', () => {
  const msg = (id, who, at, extra = {}) => ({ id, messageType: 'message', createdDateTime: at, from: { user: { id: who, displayName: who === SELF ? 'Prody' : 'Vivek' } }, body: { content: `<p>m${id}</p>` }, ...extra });
  it('counterparty last means a reply is owed', () => {
    const s = analyzeThread([msg('1', SELF, '2026-11-01T10:00:00Z'), msg('2', GUID, '2026-11-01T11:00:00Z')], SELF, new Date('2026-11-01T13:00:00Z'));
    expect(s.ball).toBe('counterparty');
    expect(s.hoursSinceLast).toBe(2);
  });
  it('our burst without an answer is counted, and system events are ignored', () => {
    const sys = { id: 's', messageType: 'systemEventMessage', createdDateTime: '2026-11-01T12:00:00Z', from: null, body: { content: '' } };
    const s = analyzeThread([msg('1', GUID, '2026-11-01T09:00:00Z'), msg('2', SELF, '2026-11-01T10:00:00Z'), msg('3', SELF, '2026-11-01T10:01:00Z'), sys], SELF);
    expect(s.ball).toBe('self');
    expect(s.trailingSelfMessages).toBe(2);
  });
  it('counts mentions of us since our last message', () => {
    const asked = msg('2', GUID, '2026-11-01T11:00:00Z', { mentions: [{ mentioned: { user: { id: SELF } } }] });
    expect(analyzeThread([msg('1', SELF, '2026-11-01T10:00:00Z'), asked], SELF).pendingMentionsOfSelf).toBe(1);
  });
  it('the operation reads me and the chat, and writes nothing', async () => {
    callGraphAPI.mockImplementation(async (t, method, endpoint) => {
      if (endpoint === 'me') return { id: SELF };
      return { value: [msg('1', GUID, '2026-11-01T11:00:00Z')] };
    });
    const r = await handleTeamsChat({ operation: 'thread_state', chatId: 'c1' });
    expect(text(r)).toMatch(/Ball: counterparty/);
  });
});

describe('findMeetingTimes conflict surfacing', () => {
  it('flags a below-100 confidence slot and names the tentative attendee', async () => {
    callGraphAPI.mockResolvedValue({
      meetingTimeSuggestions: [{
        confidence: 50,
        suggestionReason: 'Suggested because most attendees are available.',
        meetingTimeSlot: { start: { dateTime: '2026-11-06T06:30:00', timeZone: 'UTC' }, end: { dateTime: '2026-11-06T07:00:00', timeZone: 'UTC' } },
        attendeeAvailability: [
          { attendee: { emailAddress: { address: 'a@x.com' } }, availability: 'free' },
          { attendee: { emailAddress: { address: 'b@x.com' } }, availability: 'tentative' }
        ]
      }]
    });
    const tool = calendarTools.find(t => t.name === 'calendar');
    const r = await tool.handler({ operation: 'find', attendees: ['a@x.com', 'b@x.com'] });
    expect(text(r)).toMatch(/CONFLICT/);
    expect(text(r)).toMatch(/b@x.com: tentative/);
    expect(text(r)).not.toMatch(/a@x.com:/);
  });
});

describe('review follow-ups', () => {
  const { inspectMentions } = require('../utils/teams-mentions');
  const { analyzeThread } = require('../utils/teams-thread');
  test('prose containing "mentions:" is not flagged as mentions JSON', () => {
    expect(inspectMentions('<div>Key mentions: the board report</div>', []).errors).toEqual([]);
    expect(inspectMentions('<div>Two mentions: one in the MoM</div>', []).errors).toEqual([]);
  });
  test('a quoted mentions key is still flagged', () => {
    expect(inspectMentions('<div>{"mentions": [1]}</div>', []).errors.join()).toMatch(/mentions JSON/);
  });
  test('bot posts never take the ball', () => {
    const t = (min, from) => ({ messageType: 'message', createdDateTime: new Date(Date.UTC(2026, 0, 1, 10, min)).toISOString(), from, body: { content: 'x' } });
    const me = { user: { id: 'self', displayName: 'Me' } };
    const bot = { application: { id: 'app1', displayName: 'Workflows' } };
    expect(analyzeThread([t(0, { user: { id: 'other', displayName: 'O' } }), t(1, me), t(2, bot)], 'self').ball).not.toBe('counterparty');
  });
});
