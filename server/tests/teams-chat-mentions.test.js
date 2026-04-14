/**
 * Tests for mentions plumbing in Teams chat operations.
 *
 * Strategy: mock callGraphAPI and ensureAuthenticated, then invoke
 * handleTeamsChat directly to verify the Graph API is called with
 * the correct body shape.
 */

const { describe, it, expect, beforeEach } = require('@jest/globals');

// --- module mocks -----------------------------------------------------------
// Jest requires factory variables in jest.mock() to be prefixed with 'mock'.

const mockCapturedRequests = [];

jest.mock('../auth', () => ({
  ensureAuthenticated: jest.fn().mockResolvedValue('mock-access-token')
}));

jest.mock('../utils/graph-api', () => ({
  callGraphAPI: jest.fn()
}));

// Require handler AFTER mocks are in place
const handleTeamsChat = require('../teams/consolidated/teams_chat');
const { callGraphAPI } = require('../utils/graph-api');
const { ensureAuthenticated } = require('../auth');

// ---------------------------------------------------------------------------

beforeEach(() => {
  mockCapturedRequests.length = 0;
  jest.clearAllMocks();
  ensureAuthenticated.mockResolvedValue('mock-access-token');
  callGraphAPI.mockImplementation(async (token, method, endpoint, body) => {
    mockCapturedRequests.push({ method, endpoint, body });
    return { id: 'msg-123' };
  });
});

describe('sendChatMessage — mentions plumbing', () => {
  it('includes mentions in POST body when mentions are provided', async () => {
    const mentions = [
      {
        id: 0,
        mentionText: 'Nihaan',
        mentioned: {
          user: {
            id: 'user-guid-123',
            displayName: 'Nihaan Mohammed',
            userIdentityType: 'aadUser'
          }
        }
      }
    ];

    await handleTeamsChat({
      operation: 'send_message',
      chatId: 'chat-abc',
      content: '<at id="0">Nihaan</at> hello',
      mentions
    });

    expect(mockCapturedRequests).toHaveLength(1);
    const req = mockCapturedRequests[0];
    expect(req.method).toBe('POST');
    expect(req.endpoint).toContain('chat-abc/messages');
    expect(req.body).toHaveProperty('mentions');
    expect(req.body.mentions).toEqual(mentions);
  });

  it('does NOT include mentions key when no mentions are provided', async () => {
    await handleTeamsChat({
      operation: 'send_message',
      chatId: 'chat-abc',
      content: 'Hello without mentions'
    });

    expect(mockCapturedRequests).toHaveLength(1);
    expect(mockCapturedRequests[0].body).not.toHaveProperty('mentions');
  });
});

describe('updateChatMessage — mentions plumbing (bug fix)', () => {
  it('includes mentions in PATCH body when mentions are provided', async () => {
    const mentions = [
      {
        id: 0,
        mentionText: 'Nihaan',
        mentioned: {
          user: {
            id: 'user-guid-123',
            displayName: 'Nihaan Mohammed',
            userIdentityType: 'aadUser'
          }
        }
      }
    ];

    await handleTeamsChat({
      operation: 'update_message',
      chatId: 'chat-abc',
      messageId: 'msg-456',
      content: '<at id="0">Nihaan</at> updated message',
      mentions
    });

    expect(mockCapturedRequests).toHaveLength(1);
    const req = mockCapturedRequests[0];
    expect(req.method).toBe('PATCH');
    expect(req.endpoint).toContain('chat-abc/messages/msg-456');
    expect(req.body).toHaveProperty('mentions');
    expect(req.body.mentions).toEqual(mentions);
  });

  it('does NOT include mentions key when no mentions provided on update', async () => {
    await handleTeamsChat({
      operation: 'update_message',
      chatId: 'chat-abc',
      messageId: 'msg-456',
      content: 'Updated content without mentions'
    });

    expect(mockCapturedRequests).toHaveLength(1);
    expect(mockCapturedRequests[0].body).not.toHaveProperty('mentions');
  });

  it('update_message routes through renderOutbound (output uses <div>, not <p>)', async () => {
    await handleTeamsChat({
      operation: 'update_message',
      chatId: 'chat-abc',
      messageId: 'msg-456',
      content: '<p>hello</p>'
    });

    expect(mockCapturedRequests).toHaveLength(1);
    const bodyContent = mockCapturedRequests[0].body.body.content;
    expect(bodyContent).not.toMatch(/<p/i);
    expect(bodyContent).toContain('<div>');
  });
});
