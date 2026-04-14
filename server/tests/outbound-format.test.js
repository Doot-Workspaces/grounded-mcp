const { describe, it, expect } = require('@jest/globals');
const { formatHtmlOutbound, containsMarkdown, stripMarkdown } = require('../utils/outbound-format');

describe('outbound formatter', () => {
  it('renders section headings with spacing and the sign-off', () => {
    const html = formatHtmlOutbound(
      [
        'Hi user,',
        'Post-patch render test.',
        'Summary:',
        'This should preserve section spacing.',
        'Direction Agreed:',
        '- First bullet stays separate.',
        '- Second bullet stays separate.',
        '- Third bullet stays separate.',
        'Action Items:',
        '- Confirm sign-off content.',
        '- Confirm no section collapse.',
        'Thanks,',
        '-agent'
      ].join('\n'),
      { maxBodyLines: 0, signOff: '-agent' }
    );

    expect(html).toBe(
      '<p>Hi user,</p>' +
      '<p>&nbsp;</p>' +
      '<p>Post-patch render test.</p>' +
      '<p>&nbsp;</p>' +
      '<p><strong>Summary:</strong></p>' +
      '<p>&nbsp;</p>' +
      '<p>This should preserve section spacing.</p>' +
      '<p>&nbsp;</p>' +
      '<p><strong>Direction Agreed:</strong></p>' +
      '<p>&nbsp;</p>' +
      '<ul><li>First bullet stays separate.</li><li>Second bullet stays separate.</li><li>Third bullet stays separate.</li></ul>' +
      '<p>&nbsp;</p>' +
      '<p><strong>Action Items:</strong></p>' +
      '<p>&nbsp;</p>' +
      '<ul><li>Confirm sign-off content.</li><li>Confirm no section collapse.</li></ul>' +
      '<p>&nbsp;</p>' +
      '<p>Thanks,</p>' +
      '<p>&nbsp;</p>' +
      '<p>-agent</p>'
    );
  });

  it('recovers inline sections and bullets from compressed plaintext blobs', () => {
    const html = formatHtmlOutbound(
      'Summary: This should preserve section spacing. Direction Agreed: - First bullet stays separate. - Second bullet stays separate. Action Items: - Confirm sign-off content. - Confirm no section collapse. Thanks, -agent',
      { maxBodyLines: 0, signOff: '-agent' }
    );

    expect(html).toContain('<p><strong>Summary:</strong></p>');
    expect(html).toContain('<p><strong>Direction Agreed:</strong></p>');
    expect(html).toContain('<ul><li>First bullet stays separate.</li><li>Second bullet stays separate.</li></ul>');
    expect(html).toContain('<p><strong>Action Items:</strong></p>');
    expect(html).toContain('<ul><li>Confirm sign-off content.</li><li>Confirm no section collapse.</li></ul>');
    expect(html).toContain('<p>Thanks,</p>');
    expect(html.endsWith('<p>-agent</p>')).toBe(true);
  });

  it('detects Markdown bold, headings, and tables', () => {
    expect(containsMarkdown('**bold text** here')).toBe(true);
    expect(containsMarkdown('## Heading')).toBe(true);
    expect(containsMarkdown('| col1 | col2 |')).toBe(true);
    expect(containsMarkdown('Plain sentence with no markdown.')).toBe(false);
    expect(containsMarkdown('<p>Already HTML</p>')).toBe(false);
  });

  it('strips Markdown syntax cleanly', () => {
    expect(stripMarkdown('**bold**')).toBe('bold');
    expect(stripMarkdown('# Heading')).toBe('Heading');
    expect(stripMarkdown('`code snippet`')).toBe('code snippet');
    expect(stripMarkdown('*italic*')).toBe('italic');
    expect(stripMarkdown('_italic_')).toBe('italic');
  });

  it('strips Markdown before emitting HTML to avoid literal characters in Teams', () => {
    const html = formatHtmlOutbound(
      '**Status:** All done.',
      { maxBodyLines: 0, signOff: '' }
    );

    expect(html).not.toContain('**');
    expect(html).toContain('Status:');
    expect(html).toContain('All done.');
  });
});
