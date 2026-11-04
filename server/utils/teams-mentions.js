/**
 * Teams @mention preparation: resolve, validate, and warn before a send.
 *
 * A mention only pings when the HTML carries <at id="N">Name</at> and the
 * request carries a matching top-level `mentions` entry whose
 * mentioned.user.id is an AAD GUID. Every miss below was a silent no-ping or
 * a Graph 400 in a real send (2026-07-20 email-in-id near miss, 2026-08
 * mentions-JSON-inside-content, bold-name-is-not-a-tag).
 */

const { callGraphAPI } = require('./graph-api');

const GUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EMAIL_RE = /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/;
const AT_TAG_RE = /<at\s+id=["']?(\d+)["']?[^>]*>([\s\S]*?)<\/at>/gi;
const MENTIONS_JSON_RE = /["'](mentions|mentionText)["']\s*:|\bmentions\s*:\s*[\[{]/i;
const PLAIN_AT_RE = /(^|[\s>(])@[A-Za-z][\w.'-]*/;

function atTags(html) {
  const tags = [];
  const re = new RegExp(AT_TAG_RE.source, AT_TAG_RE.flags);
  let m;
  while ((m = re.exec(html)) !== null) {
    tags.push({ id: Number(m[1]), text: m[2].replace(/<[^>]*>/g, '').trim() });
  }
  return tags;
}

/**
 * Pure structural check of rendered HTML against a mentions array.
 * @returns {{ errors: string[], warnings: string[] }}
 */
function inspectMentions(html, mentions) {
  const errors = [];
  const warnings = [];
  const list = Array.isArray(mentions) ? mentions : [];
  const tags = atTags(html || '');
  const tagIds = new Set(tags.map(t => t.id));
  const seen = new Set();

  for (const entry of list) {
    const id = entry && entry.id;
    if (!Number.isInteger(id)) {
      errors.push('A mentions entry has no integer id.');
      continue;
    }
    if (seen.has(id)) errors.push(`Mention id ${id} is used twice.`);
    seen.add(id);
    if (!tagIds.has(id)) errors.push(`Mention id ${id} has no <at id="${id}">Name</at> tag in the content, so it would not ping.`);
    const user = entry.mentioned && entry.mentioned.user;
    if (user && !GUID_RE.test(String(user.id || ''))) {
      errors.push(`Mention id ${id}: mentioned.user.id must be an AAD GUID, got "${user.id}". Pass the GUID, or an email to have it resolved.`);
    }
    if (!user && !(entry.mentioned && entry.mentioned.conversation)) {
      errors.push(`Mention id ${id} names neither mentioned.user nor mentioned.conversation.`);
    }
    const tag = tags.find(t => t.id === id);
    const display = user && user.displayName;
    if (tag && display && tag.text && tag.text.toLowerCase() !== String(display).toLowerCase()) {
      warnings.push(`Mention id ${id}: the tag shows "${tag.text}" but the user is "${display}".`);
    }
  }

  for (const t of tags) {
    if (!seen.has(t.id)) errors.push(`<at id="${t.id}">${t.text}</at> has no matching mentions entry, so it would not ping.`);
  }

  const stripped = (html || '').replace(AT_TAG_RE, '');
  if (MENTIONS_JSON_RE.test(stripped.replace(/<[^>]*>/g, ' '))) {
    errors.push('The content contains mentions JSON. Pass mentions as the top-level `mentions` parameter, never inside content.');
  }
  if (PLAIN_AT_RE.test(stripped.replace(/<[^>]*>/g, ' ').replace(/\S+@\S+\.\S+/g, ''))) {
    warnings.push('The content has a plain-text "@Name" that pings nobody. Use a mentions entry plus an <at> tag.');
  }
  return { errors, warnings };
}

/**
 * Replace email/UPN ids in mentions with AAD GUIDs (one read-only lookup each).
 * Entries that already carry a GUID, or a conversation mention, pass through.
 */
async function resolveMentionUsers(accessToken, mentions) {
  if (!Array.isArray(mentions)) return mentions;
  const out = [];
  for (const entry of mentions) {
    const user = entry && entry.mentioned && entry.mentioned.user;
    if (user && EMAIL_RE.test(String(user.id || ''))) {
      let found;
      try {
        found = await callGraphAPI(accessToken, 'GET', `users/${encodeURIComponent(user.id)}`, null, { $select: 'id,displayName' });
      } catch (err) {
        throw new Error(`Could not resolve mention user "${user.id}" to an AAD id: ${err.message}`);
      }
      if (!found || !GUID_RE.test(String(found.id || ''))) {
        throw new Error(`Could not resolve mention user "${user.id}" to an AAD id.`);
      }
      out.push({
        ...entry,
        mentionText: entry.mentionText || found.displayName,
        mentioned: { ...entry.mentioned, user: { userIdentityType: 'aadUser', displayName: found.displayName, ...user, id: found.id } }
      });
    } else {
      out.push(entry);
    }
  }
  return out;
}

/**
 * Resolve then validate. Throws on any structural error; returns warnings.
 * @returns {Promise<{ mentions: Array|undefined, warnings: string[] }>}
 */
async function prepareMentions(accessToken, html, mentions) {
  const resolved = await resolveMentionUsers(accessToken, mentions);
  const { errors, warnings } = inspectMentions(html, resolved);
  if (errors.length) {
    throw new Error(`Mention check failed, nothing was sent:\n- ${errors.join('\n- ')}`);
  }
  return { mentions: Array.isArray(resolved) && resolved.length ? resolved : undefined, warnings };
}

module.exports = { inspectMentions, resolveMentionUsers, prepareMentions, GUID_RE };
