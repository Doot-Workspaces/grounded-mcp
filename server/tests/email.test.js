const { describe, it, expect, beforeEach, beforeAll, afterAll } = require('@jest/globals');
const fs = require('fs');
const os = require('os');
const path = require('path');
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

describe('Email Module - Outbound Attachments', () => {
  const mockAccessToken = 'mock-access-token';
  let mailTool;
  let fixtureDir;
  let attachPath;
  let originalAllowedRoots;

  beforeAll(() => {
    fixtureDir = fs.mkdtempSync(path.join(os.tmpdir(), 'grounded-attach-int-'));
    attachPath = path.join(fixtureDir, 'report.txt');
    fs.writeFileSync(attachPath, 'sample report contents');
    originalAllowedRoots = process.env.ATTACHMENT_ALLOWED_ROOTS;
    process.env.ATTACHMENT_ALLOWED_ROOTS = fixtureDir;
  });

  afterAll(() => {
    if (originalAllowedRoots === undefined) {
      delete process.env.ATTACHMENT_ALLOWED_ROOTS;
    } else {
      process.env.ATTACHMENT_ALLOWED_ROOTS = originalAllowedRoots;
    }
    fs.rmSync(fixtureDir, { recursive: true, force: true });
  });

  beforeEach(() => {
    jest.clearAllMocks();
    ensureAuthenticated.mockResolvedValue(mockAccessToken);
    mailTool = emailTools.find(tool => tool.name === 'mail');
  });

  it('passes attachments through to the Graph sendMail payload', async () => {
    callGraphAPI.mockResolvedValue({});

    const result = await mailTool.handler({
      operation: 'send',
      to: ['user@example.com'],
      subject: 'With attachment',
      body: 'See attached.',
      attachments: [attachPath],
    });

    expect(result.content[0].text).toBe('Email sent successfully!');
    expect(callGraphAPI).toHaveBeenCalledWith(
      mockAccessToken,
      'POST',
      'me/sendMail',
      expect.objectContaining({
        message: expect.objectContaining({
          attachments: [
            expect.objectContaining({
              '@odata.type': '#microsoft.graph.fileAttachment',
              name: 'report.txt',
              contentType: 'text/plain',
              contentBytes: Buffer.from('sample report contents').toString('base64'),
            }),
          ],
        }),
      }),
      null
    );
  });

  it('passes attachments through to the Graph draft message payload', async () => {
    callGraphAPI.mockResolvedValue({ id: 'draft-id', subject: 'With attachment' });

    await mailTool.handler({
      operation: 'draft',
      to: ['user@example.com'],
      subject: 'With attachment',
      body: 'See attached.',
      attachments: [attachPath],
    });

    expect(callGraphAPI).toHaveBeenCalledWith(
      mockAccessToken,
      'POST',
      'me/messages',
      expect.objectContaining({
        attachments: [
          expect.objectContaining({
            '@odata.type': '#microsoft.graph.fileAttachment',
            name: 'report.txt',
          }),
        ],
      }),
      null
    );
  });

  it('returns AttachmentError envelope (and skips Graph call) for paths outside the allowlist', async () => {
    callGraphAPI.mockResolvedValue({});
    const outside = path.join(os.tmpdir(), 'definitely-outside-allowed-roots.txt');
    fs.writeFileSync(outside, 'x');

    try {
      const result = await mailTool.handler({
        operation: 'send',
        to: ['user@example.com'],
        subject: 'Bad attachment',
        body: 'Should fail.',
        attachments: [outside],
      });

      expect(result.content[0].text).toMatch(/Attachment error \(PATH_NOT_ALLOWED\)/);
      expect(callGraphAPI).not.toHaveBeenCalled();
    } finally {
      fs.unlinkSync(outside);
    }
  });

  it('sends without attachments when the param is omitted (backward compat)', async () => {
    callGraphAPI.mockResolvedValue({});

    await mailTool.handler({
      operation: 'send',
      to: ['user@example.com'],
      subject: 'No attach',
      body: 'Plain body.',
    });

    const callArg = callGraphAPI.mock.calls[0][3];
    expect(callArg.message).not.toHaveProperty('attachments');
  });
});
