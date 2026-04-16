const DEFAULT_SIGN_OFF = process.env.OUTBOUND_SIGN_OFF !== undefined ? process.env.OUTBOUND_SIGN_OFF : '';
const SIGN_OFF_VARIANTS = /^(?:[-–—]\s*)?(?:Office\s+MCP|Prody-dris-agent|Prody|-agent)\s*$/i;
const RICH_HTML_PATTERN = /<(table|thead|tbody|tr|td|th|ul|ol|li|h[1-6]|blockquote|pre|code|p|div|br)\b/i;

// Markdown detection — Teams and Outlook render Markdown as literal characters.
// Policy: warn on stderr so the issue is visible; do not silently strip or convert.
// Agents should pass explicit HTML if they want bold/italic formatting.
const MARKDOWN_DETECT_RE = /(\*\*[^*\n]+\*\*)|(^\s{0,3}#{1,6}\s)|(^\|.+\|$)|(`[^`\n]+`)/m;

function detectMarkdown(text) {
  if (!text || RICH_HTML_PATTERN.test(text)) return false;
  return MARKDOWN_DETECT_RE.test(text);
}

const SECTION_HEADING_BODY = "[A-Z][A-Za-z0-9/&(),' -]{1,80}:";
const INLINE_SECTION_SPLIT_PATTERN = new RegExp(
  `(?<=[.?!])\\s+(${SECTION_HEADING_BODY})(?=\\s|$)`,
  'g'
);
const LEADING_SECTION_SPLIT_PATTERN = new RegExp(
  `^(${SECTION_HEADING_BODY})\\s+(?=[A-Z0-9])`
);
const STANDALONE_SECTION_PATTERN = new RegExp(`^${SECTION_HEADING_BODY}$`);
const INLINE_CLOSER_SPLIT_PATTERN = /(?<=[.?!])\s+(Thanks,)(?=\s|$)/g;
const SENTENCE_SPLIT_PATTERN = /(?<=[.!?])\s+(?=[A-Z0-9])/;

// ─── low-level helpers ────────────────────────────────────────────────────────

function decodeHtmlEntities(text) {
  return text
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'");
}

function extractText(html) {
  return decodeHtmlEntities(
    html
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/(p|div|li|h[1-6]|blockquote)>/gi, '\n')
      .replace(/<li[^>]*>/gi, '- ')
      .replace(/<[^>]+>/g, ' ')
  );
}

function normalizeLine(text) {
  return text.replace(/\s+/g, ' ').trim();
}

function splitStructuredLine(line) {
  const normalized = normalizeLine(line);
  if (!normalized) {
    return [''];
  }

  let expanded = normalized
    .replace(/:\s+-\s+/g, ':\n- ')
    .replace(/\s+-\s+(?=[A-Z0-9])/g, '\n- ')
    .replace(INLINE_SECTION_SPLIT_PATTERN, '\n$1')
    .replace(INLINE_CLOSER_SPLIT_PATTERN, '\n$1');

  if (!expanded.startsWith('- ')) {
    expanded = expanded.replace(LEADING_SECTION_SPLIT_PATTERN, '$1\n');
  }

  return expanded
    .split('\n')
    .flatMap(fragment => {
      const normalizedFragment = normalizeLine(fragment);
      if (!normalizedFragment) {
        return [''];
      }

      if (!normalizedFragment.startsWith('- ')) {
        return [normalizedFragment];
      }

      const bulletBody = normalizedFragment.replace(/^- /, '');
      const bulletSentences = bulletBody
        .split(SENTENCE_SPLIT_PATTERN)
        .map(sentence => normalizeLine(sentence))
        .filter(Boolean);

      if (bulletSentences.length <= 1) {
        return [normalizedFragment];
      }

      return bulletSentences.map(sentence => `- ${sentence}`);
    })
    .filter((fragment, index, fragments) => fragment || index < fragments.length - 1);
}

function splitIntoBodyLines(text) {
  const rawLines = text.replace(/\r/g, '').split('\n');
  const hasExplicitStructure = rawLines.length > 1;

  if (hasExplicitStructure) {
    const structuredLines = rawLines.flatMap(line => (line.trim() ? splitStructuredLine(line) : ['']));
    const trimmed = [];

    for (const line of structuredLines) {
      if (line === '' && (trimmed.length === 0 || trimmed[trimmed.length - 1] === '')) {
        continue;
      }
      trimmed.push(line);
    }

    while (trimmed.length > 0 && trimmed[trimmed.length - 1] === '') {
      trimmed.pop();
    }

    return trimmed;
  }

  const paragraphs = rawLines.map(normalizeLine).filter(Boolean);

  const lines = [];

  for (const paragraph of paragraphs) {
    const structuredSegments = splitStructuredLine(paragraph).filter(Boolean);

    for (const segment of structuredSegments) {
      if (/^- /.test(segment) || isSectionHeading(segment)) {
        lines.push(segment);
        continue;
      }

      const sentences = segment
        .split(SENTENCE_SPLIT_PATTERN)
        .map(normalizeLine)
        .filter(Boolean);

      if (sentences.length > 1) {
        for (const sentence of sentences) {
          lines.push(...splitStructuredLine(sentence).filter(Boolean));
        }
      } else {
        lines.push(...splitStructuredLine(segment).filter(Boolean));
      }
    }
  }

  return lines.filter(Boolean);
}

function stripExistingSignOff(lines) {
  const cleaned = [...lines];
  while (cleaned.length > 0 && cleaned[cleaned.length - 1] === '') {
    cleaned.pop();
  }
  while (cleaned.length > 0 && SIGN_OFF_VARIANTS.test(cleaned[cleaned.length - 1])) {
    cleaned.pop();
  }
  return cleaned;
}

function collapseToMaxLines(lines, maxBodyLines) {
  if (!Number.isFinite(maxBodyLines) || maxBodyLines <= 0) {
    return lines;
  }

  const nonEmptyCount = lines.filter(Boolean).length;
  if (nonEmptyCount <= maxBodyLines) {
    return lines;
  }

  const kept = [];
  let nonEmptySeen = 0;

  for (const line of lines) {
    if (line) {
      nonEmptySeen += 1;
    }

    if (nonEmptySeen < maxBodyLines) {
      kept.push(line);
      continue;
    }

    const remaining = lines
      .slice(lines.indexOf(line))
      .filter(Boolean)
      .join(' ');
    kept.push(remaining);
    break;
  }

  return kept;
}

// Matches Teams @mention markers that must pass through un-escaped to Graph:
//   <at id="0">Name</at>  |  <at id='0'>Name</at>  |  </at>
const MENTION_TAG_PATTERN = /<at\s+id=(?:"[^"]*"|'[^']*')\s*>|<\/at>/g;

function escapeHtml(text) {
  // Preserve <at id="N">...</at> Teams mention markers verbatim.
  // Without this, escapeHtml converts them to &lt;at ...&gt; and Graph rejects
  // the message with "Neither Body nor adaptive card content contains marker for mention with Id 'N'".
  const placeholders = [];
  const withPlaceholders = text.replace(MENTION_TAG_PATTERN, (match) => {
    const token = `\u0000MENTION${placeholders.length}\u0000`;
    placeholders.push(match);
    return token;
  });
  const escaped = withPlaceholders
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
  return escaped.replace(/\u0000MENTION(\d+)\u0000/g, (_, i) => placeholders[Number(i)]);
}

function isSectionHeading(line) {
  return STANDALONE_SECTION_PATTERN.test(line);
}

function ensureHtmlSignOff(html, signOff = DEFAULT_SIGN_OFF) {
  if (!signOff) return html;
  const withoutExisting = html
    .replace(/<p>\s*(?:[-–—]\s*)?(?:Office\s+MCP|Prody-dris-agent|-agent)\s*<\/p>\s*$/i, '')
    .trim();
  return `${withoutExisting}<p>${escapeHtml(signOff)}</p>`;
}

function convertLinesToHtml(lines) {
  const blocks = [];
  let listItems = [];

  const flushList = () => {
    if (listItems.length > 0) {
      blocks.push(`<ul>${listItems.join('')}</ul>`);
      listItems = [];
    }
  };

  for (const line of lines) {
    if (!line) {
      flushList();
      continue;
    }

    if (/^- /.test(line)) {
      listItems.push(`<li>${escapeHtml(line.replace(/^- /, ''))}</li>`);
      continue;
    }

    flushList();
    if (isSectionHeading(line)) {
      blocks.push(`<p><strong>${escapeHtml(line)}</strong></p>`);
      continue;
    }

    blocks.push(`<p>${escapeHtml(line)}</p>`);
  }

  flushList();
  return blocks.join('');
}

function formatPlainTextOutbound(content, options = {}) {
  const { maxBodyLines = 3, signOff = DEFAULT_SIGN_OFF } = options;
  const source = normalizeLine((content || '').replace(/\r/g, '')) ? content : '';
  const asText = /<[^>]+>/.test(source) ? extractText(source) : source;
  const sanitizedText = asText
    .replace(/\s+(?:[-–—]\s*)?(?:Office\s+MCP|Prody-dris-agent|-agent)\s*$/i, '')
    .replace(/\bThanks,\s*(?:Prody-dris-agent|-agent)\s*$/i, 'Thanks,')
    .replace(/\s+(?:[-–—]\s*)?(?:Office\s+MCP|Prody-dris-agent|-agent)\s*$/i, '');
  const bodyLines = collapseToMaxLines(
    stripExistingSignOff(splitIntoBodyLines(sanitizedText)),
    maxBodyLines
  );

  return signOff ? [...bodyLines, signOff].join('\n').trim() : bodyLines.join('\n').trim();
}

function formatHtmlOutbound(content, options = {}) {
  const { maxBodyLines = 5, signOff = DEFAULT_SIGN_OFF } = options;
  const source = (content || '').trim();

  if (RICH_HTML_PATTERN.test(source)) {
    return ensureHtmlSignOff(source, signOff);
  }

  const textMessage = formatPlainTextOutbound(source, { maxBodyLines, signOff });
  const lines = textMessage.split('\n').map(line => normalizeLine(line));
  return convertLinesToHtml(lines);
}

// ─── AST parser and target-specific serializers ───────────────────────────────

/**
 * Parse HTML or plain text into a flat array of block descriptors.
 * Block types: paragraph | bullet-list | divider
 * bullet-list blocks carry an `items` array of strings.
 */
function parseToBlocks(input) {
  const source = (input || '').trim();
  if (!source) return [];

  // If it looks like HTML, extract structure from tags
  if (RICH_HTML_PATTERN.test(source)) {
    return parseHtmlToBlocks(source);
  }

  return parsePlainTextToBlocks(source);
}

function parseHtmlToBlocks(html) {
  const blocks = [];
  // Normalize self-closing br
  let remaining = html.replace(/<br\s*\/?>/gi, '\n');

  // Strip outer <html>/<body> wrappers if present so we work on inner content
  const bodyMatch = remaining.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
  if (bodyMatch) {
    remaining = bodyMatch[1].trim();
  }

  // Split by block-level tags to produce a sequence of segments
  // We'll walk through and accumulate items/paragraphs
  const tagPattern = /<(\/?)(?:p|div|ul|ol|li|h[1-6]|blockquote|pre)([^>]*)>/gi;
  let match;
  let lastIndex = 0;
  const tokens = [];

  while ((match = tagPattern.exec(remaining)) !== null) {
    if (match.index > lastIndex) {
      const text = remaining.slice(lastIndex, match.index);
      tokens.push({ kind: 'text', value: text });
    }
    tokens.push({ kind: 'tag', closing: match[1] === '/', name: match[2] ? match[0].match(/<\/?(\w+)/)[1] : '', raw: match[0] });
    lastIndex = tagPattern.lastIndex;
  }
  if (lastIndex < remaining.length) {
    tokens.push({ kind: 'text', value: remaining.slice(lastIndex) });
  }

  // State machine: collect text inside tags.
  // paraText accumulates raw HTML (including inline tags) for each paragraph.
  // listItemText similarly accumulates raw HTML per list item.
  let inList = false;
  let listItems = [];
  let inListItem = false;
  let listItemText = '';
  let paraText = '';

  // Strip only block-level tags; preserve inline HTML (strong, em, a, at, span, etc.)
  const stripBlockTags = raw => raw.replace(/<\/?(p|div|ul|ol|li|h[1-6]|blockquote|pre)\b[^>]*>/gi, ' ');

  const flushPara = () => {
    // Preserve inline HTML so <strong>, <em>, <a>, <at> etc. survive round-trip
    const raw = paraText.trim();
    paraText = '';
    if (!raw) return;
    // For sign-off check, compare plain-text version
    const plain = normalizeLine(decodeHtmlEntities(raw.replace(/<[^>]+>/g, ' ')));
    if (!plain) return;
    blocks.push({ type: 'paragraph', content: plain, rawHtml: stripBlockTags(raw).trim() });
  };

  const flushList = () => {
    if (listItems.length > 0) {
      blocks.push({ type: 'bullet-list', items: listItems });
      listItems = [];
    }
    inList = false;
  };

  for (const token of tokens) {
    if (token.kind === 'tag') {
      const tagName = token.raw.match(/<\/?(\w+)/)?.[1]?.toLowerCase();
      if (!tagName) continue;

      if (!token.closing) {
        if (tagName === 'ul' || tagName === 'ol') {
          flushPara();
          inList = true;
        } else if (tagName === 'li') {
          inListItem = true;
          listItemText = '';
        } else if (/^(p|div|h[1-6]|blockquote|pre)$/.test(tagName)) {
          if (inList) flushList();
          flushPara();
        }
      } else {
        if (tagName === 'li') {
          const plain = normalizeLine(decodeHtmlEntities(listItemText.replace(/<[^>]+>/g, ' ')));
          if (plain) listItems.push(plain);
          inListItem = false;
          listItemText = '';
        } else if (tagName === 'ul' || tagName === 'ol') {
          flushList();
        } else if (/^(p|div|h[1-6]|blockquote|pre)$/.test(tagName)) {
          if (!inList) flushPara();
        }
      }
    } else {
      // text token
      if (inListItem) {
        listItemText += token.value;
      } else if (!inList) {
        paraText += token.value;
      }
    }
  }

  flushPara();
  if (listItems.length > 0) flushList();

  // Remove sign-off blocks
  while (blocks.length > 0) {
    const last = blocks[blocks.length - 1];
    if (last.type === 'paragraph' && SIGN_OFF_VARIANTS.test(last.content)) {
      blocks.pop();
    } else {
      break;
    }
  }

  return blocks;
}

function parsePlainTextToBlocks(text) {
  // Use existing line-parsing logic to get structured lines, then group into blocks
  const sanitizedText = text
    .replace(/\s+(?:[-–—]\s*)?(?:Office\s+MCP|Prody-dris-agent|-agent)\s*$/i, '')
    .replace(/\bThanks,\s*(?:Prody-dris-agent|-agent)\s*$/i, 'Thanks,');

  const lines = splitIntoBodyLines(sanitizedText);
  const cleanedLines = stripExistingSignOff(lines);

  const blocks = [];
  let i = 0;

  while (i < cleanedLines.length) {
    const line = cleanedLines[i];

    if (line === '') {
      i++;
      continue;
    }

    if (/^- /.test(line)) {
      const items = [];
      while (i < cleanedLines.length && /^- /.test(cleanedLines[i])) {
        items.push(cleanedLines[i].replace(/^- /, ''));
        i++;
      }
      blocks.push({ type: 'bullet-list', items });
      continue;
    }

    blocks.push({ type: 'paragraph', content: line });
    i++;
  }

  return blocks;
}

/**
 * Serialize AST blocks to Teams HTML.
 * Paragraphs -> <div>, bullets -> <ul><li>, sign-off -> <div>.
 * Keep spacing lean; rely on block elements instead of explicit spacer nodes.
 */
function serializeTeams(blocks, signOff) {
  const parts = [];

  for (let i = 0; i < blocks.length; i++) {
    const block = blocks[i];

    if (block.type === 'paragraph') {
      // parseHtmlToBlocks converts <br> → \n during parsing; restore them for Teams rendering
      const inner = (block.rawHtml || escapeHtml(block.content)).replace(/\n/g, '<br>');
      parts.push(`<div>${inner}</div>`);
    } else if (block.type === 'bullet-list') {
      parts.push(`<ul>${block.items.map(item => `<li>${escapeHtml(item)}</li>`).join('')}</ul>`);
    }
  }

  if (signOff) {
    parts.push(`<div>${escapeHtml(signOff)}</div>`);
  }

  // Join blocks with a blank-line spacer so sections are visually separated in Teams
  return parts.join('<div><br></div>');
}

/**
 * Serialize AST blocks to email HTML.
 * Paragraphs -> <p>, bullets -> <ul><li>, wrapped in full <html><style><body> shell.
 */
function serializeEmail(blocks, signOff) {
  const parts = [];

  for (let i = 0; i < blocks.length; i++) {
    const block = blocks[i];

    if (block.type === 'paragraph') {
      if (isSectionHeading(block.content)) {
        // Use rawHtml if available (preserves inline tags), else escape plain text
        const inner = block.rawHtml || escapeHtml(block.content);
        parts.push(`<p><strong>${inner}</strong></p>`);
      } else {
        const inner = block.rawHtml || escapeHtml(block.content);
        parts.push(`<p>${inner}</p>`);
      }
    } else if (block.type === 'bullet-list') {
      parts.push(`<ul>${block.items.map(item => `<li>${escapeHtml(item)}</li>`).join('')}</ul>`);
    }
  }

  if (signOff) {
    parts.push(`<p>${escapeHtml(signOff)}</p>`);
  }

  const bodyInner = parts.join('');

  return `<html>
<head>
<style>
body {
  font-family: 'Segoe UI', Tahoma, Geneva, Verdana, Arial, sans-serif;
  font-size: 11pt;
  color: #333333;
}
table {
  border-collapse: collapse;
  margin: 10px 0;
}
th, td {
  border: 1px solid #ddd;
  padding: 8px;
  text-align: left;
}
th {
  background-color: #f2f2f2;
  font-weight: bold;
}
h3 {
  color: #2c3e50;
  margin-top: 15px;
  margin-bottom: 10px;
}
ul, ol {
  margin: 10px 0;
}
</style>
</head>
<body>${bodyInner}</body>
</html>`;
}

// ─── public surface ───────────────────────────────────────────────────────────

/**
 * The ONE canonical outbound formatting function.
 *
 * @param {object} opts
 * @param {string} opts.content   - Raw input: HTML or plain text
 * @param {'teams'|'email'} opts.target - Rendering target
 * @param {string} [opts.signOff] - Trailing sign-off line; defaults to OUTBOUND_SIGN_OFF env or '-agent'
 * @param {Array}  [opts.mentions] - Pass-through only; renderOutbound does not modify it
 * @returns {{ html: string, contentType: 'html' }}
 */
function renderOutbound({ content, target, signOff, mentions }) {
  if (target !== 'teams' && target !== 'email') {
    throw new Error(`renderOutbound: unknown target '${target}'. Must be 'teams' or 'email'.`);
  }

  // Markdown warning — platforms render it as literal characters. Warn loudly; don't modify.
  if (detectMarkdown(content)) {
    console.warn(
      `[grounded-mcp] Markdown detected in outbound content for target='${target}'. ` +
      `Teams and Outlook render Markdown as literal characters. ` +
      `Pass explicit HTML (<strong>, <em>, <p>, <br>) instead.`
    );
  }

  const resolvedSignOff = signOff !== undefined ? signOff : DEFAULT_SIGN_OFF;

  // Step 1: parse into AST
  const blocks = parseToBlocks(content);

  // Step 2: target-specific serialize + sign-off
  let html;
  if (target === 'teams') {
    html = serializeTeams(blocks, resolvedSignOff);
  } else {
    html = serializeEmail(blocks, resolvedSignOff);
  }

  return { html, contentType: 'html' };
}

module.exports = {
  DEFAULT_SIGN_OFF,
  formatPlainTextOutbound,
  formatHtmlOutbound,
  renderOutbound,
  detectMarkdown
};
