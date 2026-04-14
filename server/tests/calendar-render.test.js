const { describe, it, expect, beforeEach } = require('@jest/globals');
const { calendarTools } = require('../calendar');
const { ensureAuthenticated } = require('../auth');
const { callGraphAPI } = require('../utils/graph-api');
const { renderOutbound } = require('../utils/outbound-format');

jest.mock('../auth', () => ({
  ensureAuthenticated: jest.fn()
}));
jest.mock('../utils/graph-api');

describe('Calendar Module - renderOutbound body wrapping', () => {
  const mockAccessToken = 'mock-access-token';
  let calendarTool;

  beforeEach(() => {
    jest.clearAllMocks();
    ensureAuthenticated.mockResolvedValue(mockAccessToken);
    calendarTool = calendarTools.find(tool => tool.name === 'calendar');
    callGraphAPI.mockResolvedValue({ id: 'mock-event-id' });
  });

  describe('create_event body wrapping', () => {
    it('wraps a plain-text body in the email-style HTML shell', async () => {
      await calendarTool.handler({
        operation: 'create',
        subject: 'Team Sync',
        start: '2026-04-14T10:00:00',
        end: '2026-04-14T11:00:00',
        content: 'Discuss Q2 roadmap priorities.'
      });

      expect(callGraphAPI).toHaveBeenCalledWith(
        mockAccessToken,
        'POST',
        'me/calendar/events',
        expect.objectContaining({
          body: expect.objectContaining({
            contentType: 'HTML',
            content: expect.stringContaining('<html>')
          })
        })
      );

      // Confirm the Segoe UI style shell is present
      const callArg = callGraphAPI.mock.calls[0][3];
      expect(callArg.body.content).toContain("font-family: 'Segoe UI'");
      expect(callArg.body.content).toContain('<p>Discuss Q2 roadmap priorities.</p>');
    });

    it('does NOT append a sign-off to the event body', async () => {
      await calendarTool.handler({
        operation: 'create',
        subject: 'Budget Review',
        start: '2026-04-14T14:00:00',
        end: '2026-04-14T15:00:00',
        content: 'Review the annual budget.'
      });

      const callArg = callGraphAPI.mock.calls[0][3];
      const bodyContent = callArg.body.content;
      expect(bodyContent).not.toContain('-agent');
      expect(bodyContent).not.toContain('Prody');
      expect(bodyContent).not.toContain('Office MCP');
    });

    it('wraps an HTML body through renderOutbound (normalized, no sign-off)', async () => {
      const htmlInput = '<p>Agenda:</p><ul><li>Item 1</li><li>Item 2</li></ul>';

      await calendarTool.handler({
        operation: 'create',
        subject: 'Planning Session',
        start: '2026-04-15T09:00:00',
        end: '2026-04-15T10:00:00',
        content: htmlInput
      });

      // Verify it went through renderOutbound, not raw assignment
      const { html: expected } = renderOutbound({ content: htmlInput, target: 'email', signOff: '' });
      const callArg = callGraphAPI.mock.calls[0][3];
      expect(callArg.body.content).toBe(expected);
    });

    it('creates an event with no body without error — body is set to the empty-shell HTML', async () => {
      await calendarTool.handler({
        operation: 'create',
        subject: 'No-body Event',
        start: '2026-04-16T10:00:00',
        end: '2026-04-16T11:00:00'
      });

      // Should not throw; Graph API should be called with a body field
      expect(callGraphAPI).toHaveBeenCalledWith(
        mockAccessToken,
        'POST',
        'me/calendar/events',
        expect.objectContaining({
          body: expect.objectContaining({
            contentType: 'HTML',
            content: expect.any(String)
          })
        })
      );

      // Body content is the HTML shell (not a raw empty string)
      const callArg = callGraphAPI.mock.calls[0][3];
      expect(callArg.body.content).toContain('<html>');
      expect(callArg.body.content).not.toContain('-agent');
    });
  });

  describe('update_event body wrapping', () => {
    it('wraps a plain-text update body in the email-style HTML shell', async () => {
      callGraphAPI.mockResolvedValue({});

      await calendarTool.handler({
        operation: 'update',
        eventId: 'evt-abc-123',
        body: 'Updated agenda: cover deployment timeline.'
      });

      expect(callGraphAPI).toHaveBeenCalledWith(
        mockAccessToken,
        'PATCH',
        'me/events/evt-abc-123',
        expect.objectContaining({
          body: expect.objectContaining({
            contentType: 'HTML',
            content: expect.stringContaining('<html>')
          })
        })
      );

      const callArg = callGraphAPI.mock.calls[0][3];
      expect(callArg.body.content).toContain('<p>Updated agenda: cover deployment timeline.</p>');
      expect(callArg.body.content).not.toContain('-agent');
    });

    it('wraps an HTML update body through renderOutbound without appending a sign-off', async () => {
      callGraphAPI.mockResolvedValue({});

      const htmlInput = '<p>Revised scope.</p><ul><li>Action A</li><li>Action B</li></ul>';
      const { html: expected } = renderOutbound({ content: htmlInput, target: 'email', signOff: '' });

      await calendarTool.handler({
        operation: 'update',
        eventId: 'evt-abc-456',
        body: htmlInput
      });

      const callArg = callGraphAPI.mock.calls[0][3];
      expect(callArg.body.content).toBe(expected);
      expect(callArg.body.content).not.toContain('-agent');
    });

    it('updates only non-body fields without touching body when no body provided', async () => {
      callGraphAPI.mockResolvedValue({});

      await calendarTool.handler({
        operation: 'update',
        eventId: 'evt-abc-789',
        subject: 'Renamed Event'
      });

      expect(callGraphAPI).toHaveBeenCalledWith(
        mockAccessToken,
        'PATCH',
        'me/events/evt-abc-789',
        expect.objectContaining({ subject: 'Renamed Event' })
      );

      // body key should not appear in the update payload
      const callArg = callGraphAPI.mock.calls[0][3];
      expect(callArg).not.toHaveProperty('body');
    });
  });
});
