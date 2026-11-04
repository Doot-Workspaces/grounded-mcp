/**
 * Thread-state analysis for a Teams chat: who owns the ball.
 *
 * Rule (Nihaan, 2026-05-22): the last human message decides. If the
 * counterparty wrote last, the next reply is ours; a burst of our own
 * messages without an answer still leaves the ball with the counterparty.
 * System events and deleted messages never count.
 */

// Only user-authored messages count. Bot and app posts (Workflows, connectors) have no from.user.
function authorId(m) {
  return (m.from && m.from.user && m.from.user.id) || null;
}

function authorName(m) {
  return (m.from && m.from.user && m.from.user.displayName) ||
    (m.from && m.from.application && m.from.application.displayName) || 'Unknown';
}

function plain(m) {
  return String((m.body && m.body.content) || '').replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
}

/**
 * @param {Array} messages Graph chatMessage objects, any order
 * @param {string} selfId  AAD id of the sending identity
 * @param {Date} [now]
 */
function analyzeThread(messages, selfId, now = new Date()) {
  const human = (messages || [])
    .filter(m => m && m.messageType === 'message' && !m.deletedDateTime && authorId(m))
    .sort((a, b) => new Date(a.createdDateTime) - new Date(b.createdDateTime));

  if (human.length === 0) {
    return { ball: 'none', note: 'No human messages in the window.', recent: [] };
  }
  const last = human[human.length - 1];
  const ball = authorId(last) === selfId ? 'self' : 'counterparty';

  let trailingSelf = 0;
  for (let i = human.length - 1; i >= 0 && authorId(human[i]) === selfId; i--) trailingSelf++;

  const lastSelfIdx = human.map(authorId).lastIndexOf(selfId);
  const pendingMentions = human.slice(lastSelfIdx + 1).filter(m =>
    (m.mentions || []).some(x => x.mentioned && x.mentioned.user && x.mentioned.user.id === selfId));

  const hoursSinceLast = Math.max(0, Math.round(((now - new Date(last.createdDateTime)) / 36e5) * 10) / 10);

  return {
    ball,
    lastAuthor: authorName(last),
    lastAt: last.createdDateTime,
    hoursSinceLast,
    trailingSelfMessages: trailingSelf,
    pendingMentionsOfSelf: pendingMentions.length,
    guidance: ball === 'counterparty'
      ? 'Counterparty wrote last: a reply is owed (Reply Now).'
      : 'Our side wrote last: Watch or Ignore. Do not draft a completeness follow-up unless asked.',
    recent: human.slice(-8).map(m => ({
      from: authorName(m),
      at: m.createdDateTime,
      text: plain(m).slice(0, 160)
    }))
  };
}

function formatThreadState(s) {
  if (s.ball === 'none') return `Thread state: ${s.note}`;
  const lines = [
    `Ball: ${s.ball}`,
    `Last message: ${s.lastAuthor}, ${s.lastAt} (${s.hoursSinceLast}h ago)`,
    `Our unanswered burst: ${s.trailingSelfMessages}`,
    `Mentions of us since our last message: ${s.pendingMentionsOfSelf}`,
    s.guidance,
    '',
    'Recent messages (oldest first):'
  ];
  for (const r of s.recent) lines.push(`- ${r.from} (${r.at}): ${r.text}`);
  return lines.join('\n');
}

module.exports = { analyzeThread, formatThreadState };
