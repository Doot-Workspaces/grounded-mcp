#!/usr/bin/env node

const path = require('path');

require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const { emailTools } = require('../email');
const handleTeamsChat = require('../teams/consolidated/teams_chat');
const config = require('../config');
const { ensureAuthenticated } = require('../auth');
const { callGraphAPI } = require('../utils/graph-api');
const { formatRuntimeMetadataText, getRuntimeMetadata } = require('../utils/runtime-metadata');

function parseArgs(argv) {
  const parsed = {};

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];

    if (!token.startsWith('--')) {
      continue;
    }

    if (token === '--help') {
      parsed.help = true;
      continue;
    }

    const key = token.slice(2);
    const nextValue = argv[index + 1];

    if (!nextValue || nextValue.startsWith('--')) {
      parsed[key] = true;
      continue;
    }

    parsed[key] = nextValue;
    index += 1;
  }

  return parsed;
}

function printUsage() {
  console.log(`Usage:
  node scripts/live-format-smoke-test.js \\
    --mailbox product@your-org.com \\
    --outlook-to you@your-org.com \\
    --teams-chat-id 19:...@thread.v2

Optional:
  --marker-prefix office-mcp-smoke

This script sends exactly 4 live messages:
  1. Outlook new mail
  2. Outlook reply on that same thread
  3. Teams new message in the target chat
  4. Teams follow-up reply-style message in the same chat

It then fetches the exact sent/readback bodies and prints a JSON report.
Use a self-addressed mailbox and a private test chat. Do not point this at a live external thread.`);
}

function makeMarker(prefix) {
  const now = new Date();
  const stamp = [
    now.getUTCFullYear(),
    String(now.getUTCMonth() + 1).padStart(2, '0'),
    String(now.getUTCDate()).padStart(2, '0'),
    String(now.getUTCHours()).padStart(2, '0'),
    String(now.getUTCMinutes()).padStart(2, '0'),
    String(now.getUTCSeconds()).padStart(2, '0')
  ].join('');

  return `${prefix}-${stamp}Z`;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function summarizeOutlookHtml(html) {
  return {
    hasParagraphs: /<p>/i.test(html),
    hasBoldLabel: /<strong>Checks:<\/strong>|<strong>Expectation:<\/strong>|<b>Checks:<\/b>|<b>Expectation:<\/b>/i.test(html),
    hasList: /<(ul|ol)>/i.test(html) && /<li>/i.test(html),
    hasMarker: /Marker:/i.test(html)
  };
}

function summarizeTeamsHtml(html) {
  return {
    hasParagraphs: /<p>/i.test(html),
    hasForcedSpacing: /<br>\s*<br>/i.test(html),
    hasBoldLabel: /<strong>Checks:<\/strong>|<strong>Expectation:<\/strong>/i.test(html),
    hasList: /<(ul|ol)>/i.test(html) && /<li>/i.test(html),
    hasMarker: /Marker:/i.test(html)
  };
}

function parseIdFromToolText(text) {
  const match = text.match(/ID:\s*([^\s]+)/);
  return match ? match[1].trim() : null;
}

function textFromResult(result) {
  return Array.isArray(result?.content) ? result.content.map((item) => item.text || '').join('\n') : '';
}

async function getRecentSentItems(accessToken, mailbox) {
  const response = await callGraphAPI(
    accessToken,
    'GET',
    `${config.getMailboxPrefix(mailbox)}/mailFolders/sentitems/messages`,
    null,
    {
      $top: 25,
      $orderby: 'receivedDateTime desc',
      $select: 'id,subject,receivedDateTime,body,toRecipients,ccRecipients,from'
    }
  );

  return response.value || [];
}

async function getRecentChatMessages(accessToken, chatId) {
  const response = await callGraphAPI(
    accessToken,
    'GET',
    `chats/${chatId}/messages`,
    null,
    {
      $top: 25,
      $orderby: 'createdDateTime desc'
    }
  );

  return response.value || [];
}

async function poll(findFn, description, attempts = 10, delayMs = 1000) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const result = await findFn();
    if (result) {
      return result;
    }

    if (attempt < attempts - 1) {
      await sleep(delayMs);
    }
  }

  throw new Error(`Timed out waiting for ${description}`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (args.help) {
    printUsage();
    process.exit(0);
  }

  const mailbox = args.mailbox;
  const outlookTo = args['outlook-to'];
  const teamsChatId = args['teams-chat-id'];
  const markerPrefix = args['marker-prefix'] || 'office-mcp-smoke';

  if (!mailbox || !outlookTo || !teamsChatId) {
    printUsage();
    process.exit(1);
  }

  const marker = makeMarker(markerPrefix);
  const runtimeMetadata = getRuntimeMetadata(config);
  const outlookSubject = `Office MCP live format smoke test | ${marker}`;
  const mailTool = emailTools.find((tool) => tool.name === 'mail');

  if (!mailTool) {
    throw new Error('Mail tool not found.');
  }

  const accessToken = await ensureAuthenticated();

  const sendEmailResult = await mailTool.handler({
    operation: 'send',
    mailbox,
    to: [outlookTo],
    subject: outlookSubject,
    body: `<p>This is the Outlook send-path smoke test.</p><p><strong>Checks:</strong></p><ul><li>Paragraph spacing should survive in the sent copy.</li><li>Bold label rendering should stay visible.</li><li>List structure should remain a real list.</li></ul><p><strong>Marker:</strong> ${marker}</p>`
  });

  if (!/Email sent successfully/i.test(textFromResult(sendEmailResult))) {
    throw new Error(`Outlook send failed: ${textFromResult(sendEmailResult)}`);
  }

  const sendEmail = await poll(async () => {
    const items = await getRecentSentItems(accessToken, mailbox);
    return items.find((item) => item.subject === outlookSubject);
  }, 'Outlook send item');

  const replyResult = await mailTool.handler({
    operation: 'reply',
    mailbox,
    emailId: sendEmail.id,
    to: [outlookTo],
    body: `<p>This is the Outlook reply-path smoke test on the same thread.</p><p><strong>Expectation:</strong></p><ul><li>The reply block itself should keep paragraph spacing.</li><li>The bold label should remain bold.</li><li>The list should remain a real list inside the reply block.</li></ul><p><strong>Marker:</strong> ${marker}</p>`
  });

  if (!/Reply sent successfully/i.test(textFromResult(replyResult))) {
    throw new Error(`Outlook reply failed: ${textFromResult(replyResult)}`);
  }

  const replyEmail = await poll(async () => {
    const items = await getRecentSentItems(accessToken, mailbox);
    return items.find(
      (item) =>
        item.subject === `RE: ${outlookSubject}` &&
        (item.body?.content || '').includes(marker)
    );
  }, 'Outlook reply item');

  const teamsSendResult = await handleTeamsChat({
    operation: 'send_message',
    chatId: teamsChatId,
    content: `<p>This is the Teams send-path smoke test.</p><p><strong>Checks:</strong></p><ul><li>Visible spacing should remain between sections.</li><li>The bold label should stay visually distinct.</li><li>The list should remain a list.</li></ul><p><strong>Marker:</strong> ${marker}</p>`
  });

  const teamsSendId = parseIdFromToolText(textFromResult(teamsSendResult));
  if (!teamsSendId) {
    throw new Error(`Teams send failed: ${textFromResult(teamsSendResult)}`);
  }

  const teamsSend = await poll(async () => {
    const items = await getRecentChatMessages(accessToken, teamsChatId);
    return items.find((item) => item.id === teamsSendId);
  }, 'Teams send message');

  const teamsReplyResult = await handleTeamsChat({
    operation: 'send_message',
    chatId: teamsChatId,
    replyToId: teamsSend.id,
    content: `<p>This is the Teams reply-path smoke test in the same chat.</p><p><strong>Expectation:</strong></p><ul><li>The reply itself should keep visible spacing between sections.</li><li>The bold label should remain visually distinct.</li><li>The list should remain a list.</li></ul><p><strong>Marker:</strong> ${marker}</p>`
  });

  const teamsReplyId = parseIdFromToolText(textFromResult(teamsReplyResult));
  if (!teamsReplyId) {
    throw new Error(`Teams reply failed: ${textFromResult(teamsReplyResult)}`);
  }

  const teamsReply = await poll(async () => {
    const items = await getRecentChatMessages(accessToken, teamsChatId);
    return items.find((item) => item.id === teamsReplyId);
  }, 'Teams reply message');

  const outlookSendFull = await callGraphAPI(
    accessToken,
    'GET',
    `${config.getMailboxPrefix(mailbox)}/messages/${sendEmail.id}`,
    null,
    { $select: 'id,subject,body,toRecipients' }
  );
  const outlookReplyFull = await callGraphAPI(
    accessToken,
    'GET',
    `${config.getMailboxPrefix(mailbox)}/messages/${replyEmail.id}`,
    null,
    { $select: 'id,subject,body,toRecipients' }
  );
  const teamsSendFull = await callGraphAPI(accessToken, 'GET', `chats/${teamsChatId}/messages/${teamsSend.id}`);
  const teamsReplyFull = await callGraphAPI(accessToken, 'GET', `chats/${teamsChatId}/messages/${teamsReply.id}`);

  const report = {
    marker,
    runtime: runtimeMetadata,
    outlookSend: {
      id: outlookSendFull.id,
      subject: outlookSendFull.subject,
      toRecipients: outlookSendFull.toRecipients,
      bodyContentType: outlookSendFull.body?.contentType,
      assertions: summarizeOutlookHtml(outlookSendFull.body?.content || ''),
      bodyContent: outlookSendFull.body?.content
    },
    outlookReply: {
      id: outlookReplyFull.id,
      subject: outlookReplyFull.subject,
      toRecipients: outlookReplyFull.toRecipients,
      bodyContentType: outlookReplyFull.body?.contentType,
      assertions: summarizeOutlookHtml(outlookReplyFull.body?.content || ''),
      bodyContent: outlookReplyFull.body?.content
    },
    teamsSend: {
      id: teamsSendFull.id,
      replyToId: teamsSendFull.replyToId || null,
      bodyContentType: teamsSendFull.body?.contentType,
      assertions: summarizeTeamsHtml(teamsSendFull.body?.content || ''),
      bodyContent: teamsSendFull.body?.content
    },
    teamsReply: {
      id: teamsReplyFull.id,
      replyToId: teamsReplyFull.replyToId || null,
      bodyContentType: teamsReplyFull.body?.contentType,
      assertions: summarizeTeamsHtml(teamsReplyFull.body?.content || ''),
      bodyContent: teamsReplyFull.body?.content
    }
  };

  console.error('Runtime fingerprint');
  console.error(formatRuntimeMetadataText(runtimeMetadata));
  console.log(JSON.stringify(report, null, 2));
}

main().catch((error) => {
  console.error(error && error.stack ? error.stack : String(error));
  process.exit(1);
});
