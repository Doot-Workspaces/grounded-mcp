const { describe, it, expect } = require('@jest/globals');
const { formatHtmlOutbound, renderOutbound, detectMarkdown } = require('../utils/outbound-format');

describe('outbound formatter (legacy formatHtmlOutbound)', () => {
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
      '<p>Post-patch render test.</p>' +
      '<p><strong>Summary:</strong></p>' +
      '<p>This should preserve section spacing.</p>' +
      '<p><strong>Direction Agreed:</strong></p>' +
      '<ul><li>First bullet stays separate.</li><li>Second bullet stays separate.</li><li>Third bullet stays separate.</li></ul>' +
      '<p><strong>Action Items:</strong></p>' +
      '<ul><li>Confirm sign-off content.</li><li>Confirm no section collapse.</li></ul>' +
      '<p>Thanks,</p>' +
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
});

describe('renderOutbound — Teams target', () => {
  it('converts <p> HTML input to <div> output with spacers — never emits <p> for Teams', () => {
    const { html, contentType } = renderOutbound({
      content: '<p>para1</p><p>para2</p>',
      target: 'teams',
      signOff: ''
    });

    expect(contentType).toBe('html');
    expect(html).not.toMatch(/<p/i);
    expect(html).toContain('<div>para1</div>');
    expect(html).toContain('<div>para2</div>');
    // Blocks are separated by blank-line spacers so sections have visible spacing in Teams
    expect(html).toContain('<div>para1</div><div><br></div><div>para2</div>');
  });

  it('plain text with blank-line separation produces spaced <div> blocks', () => {
    const { html } = renderOutbound({
      content: 'para1\n\npara2',
      target: 'teams',
      signOff: ''
    });

    expect(html).not.toMatch(/<p/i);
    expect(html).toContain('<div>para1</div>');
    // Blocks are separated by blank-line spacers for visible spacing in Teams
    expect(html).toContain('<div>para1</div><div><br></div><div>para2</div>');
  });


  it('preserves inline strong and em tags for Teams paragraph content', () => {
    const { html } = renderOutbound({
      content: '<p><strong>Status:</strong> Ready and <em>validated</em>.</p><p>Next step.</p>',
      target: 'teams',
      signOff: ''
    });

    expect(html).toContain('<div><strong>Status:</strong> Ready and <em>validated</em>.</div>');
    expect(html).toContain('<div>Next step.</div>');
    expect(html).not.toContain('&lt;strong&gt;');
    expect(html).not.toContain('&lt;em&gt;');
  });
  it('markdown-ish bullets produce <ul><li> for Teams', () => {
    const { html } = renderOutbound({
      content: '- one\n- two',
      target: 'teams',
      signOff: ''
    });

    expect(html).toContain('<ul>');
    expect(html).toContain('<li>one</li>');
    expect(html).toContain('<li>two</li>');
    expect(html).not.toMatch(/<p/i);
  });

  it('treats bare Prody as an existing sign-off on reprocessing', () => {
    const first = renderOutbound({
      content: 'Hello',
      target: 'teams',
      signOff: 'Prody'
    });

    const second = renderOutbound({
      content: first.html,
      target: 'teams',
      signOff: 'Prody'
    });

    const signOffCount = (second.html.match(/Prody/g) || []).length;
    expect(signOffCount).toBe(1);
  });

  it('appends sign-off exactly once even on reprocessing', () => {
    const first = renderOutbound({
      content: 'Hello',
      target: 'teams',
      signOff: '-agent'
    });

    // Feed the output back in — sign-off should still appear exactly once
    const second = renderOutbound({
      content: first.html,
      target: 'teams',
      signOff: '-agent'
    });

    const signOffCount = (second.html.match(/-agent/g) || []).length;
    expect(signOffCount).toBe(1);
  });

  it('emits <div><br></div> spacers between blocks — not &nbsp; spacers', () => {
    const { html } = renderOutbound({
      content: '<p>para1</p><p>para2</p><p>para3</p>',
      target: 'teams',
      signOff: ''
    });

    // Correct spacer: <div><br></div> — creates visible blank lines in Teams
    expect(html).toContain('<div><br></div>');
    // Wrong spacer: <div>&nbsp;</div> — never use this
    expect(html).not.toContain('<div>&nbsp;</div>');
  });
});

describe('renderOutbound — Email target', () => {
  it('plain text input is wrapped in <html>/<style>/<body> with Segoe UI 11pt', () => {
    const { html, contentType } = renderOutbound({
      content: 'Hello world',
      target: 'email',
      signOff: ''
    });

    expect(contentType).toBe('html');
    expect(html).toContain('<html>');
    expect(html).toContain('<style>');
    expect(html).toContain('Segoe UI');
    expect(html).toContain('11pt');
    expect(html).toContain('<body>');
    expect(html).toContain('<p>Hello world</p>');
  });

  it('rich HTML input is preserved and still wrapped in the shell', () => {
    const { html } = renderOutbound({
      content: '<p>Rich <strong>text</strong></p>',
      target: 'email',
      signOff: ''
    });

    expect(html).toContain('<html>');
    expect(html).toContain('<style>');
    expect(html).toContain('Rich');
    expect(html).toContain('<strong>text</strong>');
  });

  it('paragraphs use <p> not <div> for email', () => {
    const { html } = renderOutbound({
      content: 'Line one\n\nLine two',
      target: 'email',
      signOff: ''
    });

    expect(html).toContain('<p>Line one</p>');
    expect(html).toContain('<p>Line two</p>');
    expect(html).not.toMatch(/<div>Line/);
  });
});

describe('markdown detection', () => {
  it('detects **bold**, headings, inline code, and pipe tables', () => {
    expect(detectMarkdown('**bold text** here')).toBe(true);
    expect(detectMarkdown('## Heading')).toBe(true);
    expect(detectMarkdown('use `code here`')).toBe(true);
    expect(detectMarkdown('| col | col |')).toBe(true);
  });

  it('does not flag plain text or explicit HTML', () => {
    expect(detectMarkdown('Plain sentence, no markdown.')).toBe(false);
    expect(detectMarkdown('<p>Already HTML</p>')).toBe(false);
    expect(detectMarkdown('<strong>bold</strong> is fine')).toBe(false);
  });

  it('warns but does not modify content when markdown is detected', () => {
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});

    const { html } = renderOutbound({
      content: '**Status:** All done.',
      target: 'teams',
      signOff: ''
    });

    expect(warnSpy).toHaveBeenCalled();
    expect(warnSpy.mock.calls[0][0]).toMatch(/Markdown detected/);
    // Content passes through unchanged (asterisks visible — that's the intended visibility signal)
    expect(html).toContain('**Status:**');

    warnSpy.mockRestore();
  });

  it('does not warn for clean HTML or plain text', () => {
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});

    renderOutbound({ content: '<p>Clean HTML</p>', target: 'teams', signOff: '' });
    renderOutbound({ content: 'Plain text message.', target: 'teams', signOff: '' });

    expect(warnSpy).not.toHaveBeenCalled();
    warnSpy.mockRestore();
  });
});
