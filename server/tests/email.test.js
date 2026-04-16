const { describe, it, expect, beforeEach } = require('@jest/globals');
const { emailTools } = require('../email');
const { ensureAuthenticated } = require('../auth');
const { callGraphAPI } = require('../utils/graph-api');

jest.mock('../auth', () => ({
  ensureAuthenticated: jest.fn()
}));
jest.mock('../utils/graph-api');

describe('Email Module - Formatting Enforcement', () => {
  const mockAccessToken = 'mock-access-token';
  let mailTool;

  beforeEach(() => {
    jest.clearAllMocks();
    ensureAuthenticated.mockResolvedValue(mockAccessToken);
    mailTool = emailTools.find(tool => tool.name === 'mail');
  });

  it('should format outbound send bodies before calling Graph', async () => {
    callGraphAPI.mockResolvedValue({});

    await mailTool.handler({
      operation: 'send',
      to: ['user@example.com'],
      subject: 'Formatting test',
      body: 'Fixed locally. New 2-person chats will now open as one-on-one chats. This email validates the outbound formatter.'
    });

    expect(callGraphAPI).toHaveBeenCalledWith(
      mockAccessToken,
      'POST',
      'me/sendMail',
      expect.objectContaining({
        message: expect.objectContaining({
          body: expect.objectContaining({
            contentType: 'HTML',
            content: expect.stringContaining('<p>Fixed locally.</p><p>New 2-person chats will now open as one-on-one chats.</p><p>This email validates the outbound formatter.</p>')
          })
        })
      }),
      null
    );
  });

  it('should create an HTML reply draft, update the body, and send it', async () => {
    callGraphAPI
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({
        value: [{
          id: 'draft-reply-id',
          body: { content: '<html><body><div>Quoted thread</div></body></html>' }
        }]
      })
      .mockResolvedValueOnce({ id: 'draft-reply-id' })
      .mockResolvedValueOnce({});

    await mailTool.handler({
      operation: 'reply',
      emailId: 'email-id',
      body: 'Fixed locally. New 2-person chats will now open as one-on-one chats. This email validates the outbound formatter.'
    });

    expect(callGraphAPI).toHaveBeenCalledWith(
      mockAccessToken,
      'POST',
      'me/messages/email-id/createReply',
      null,
      null
    );

    expect(callGraphAPI).toHaveBeenCalledWith(
      mockAccessToken,
      'PATCH',
      'me/messages/draft-reply-id',
      expect.objectContaining({
        body: expect.objectContaining({
          contentType: 'HTML',
          content: expect.stringContaining('<div class="mcp-reply-block"><p>Fixed locally.</p><p>New 2-person chats will now open as one-on-one chats.</p><p>This email validates the outbound formatter.</p></div>')
        })
      }),
      null
    );
  });

  it('should format draft bodies before saving', async () => {
    callGraphAPI.mockResolvedValue({ id: 'draft-id', subject: 'Formatting test' });

    await mailTool.handler({
      operation: 'draft',
      to: ['user@example.com'],
      subject: 'Formatting test',
      body: 'Fixed locally. New 2-person chats will now open as one-on-one chats. This draft validates the outbound formatter.'
    });

    expect(callGraphAPI).toHaveBeenCalledWith(
      mockAccessToken,
      'POST',
      'me/messages',
      expect.objectContaining({
        body: expect.objectContaining({
          contentType: 'HTML',
          content: expect.stringContaining('<p>Fixed locally.</p><p>New 2-person chats will now open as one-on-one chats.</p><p>This draft validates the outbound formatter.</p>')
        })
      }),
      null
    );
  });
});
