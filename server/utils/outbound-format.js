const DEFAULT_SIGN_OFF = process.env.OUTBOUND_SIGN_OFF !== undefined ? process.env.OUTBOUND_SIGN_OFF : '-agent';
const SIGN_OFF_VARIANTS = /^(?:[-–—]\s*)?(?:Office\s+MCP|Prody-dris-agent|-agent)\s*$/i;
const RICH_HTML_PATTERN = /<(table|thead|tbody|tr|td|th|ul|ol|li|h[1-6]|blockquote|pre|code|p|div|br)\b/i;
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

function escapeHtml(text) {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
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
      if (blocks.length > 0) {
        blocks.push('<p>&nbsp;</p>');
      }
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
    if (blocks.length > 0) {
      blocks.push('<p>&nbsp;</p>');
    }

    if (isSectionHeading(line)) {
      blocks.push(`<p><strong>${escapeHtml(line)}</strong></p>`);
      continue;
    }

    blocks.push(`<p>${escapeHtml(line)}</p>`);
  }

  flushList();
  return blocks.join('');
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

module.exports = {
  DEFAULT_SIGN_OFF,
  formatPlainTextOutbound,
  formatHtmlOutbound
};
