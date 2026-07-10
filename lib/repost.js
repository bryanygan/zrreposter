const THREAD_NAME_MAX = 100;
const MESSAGE_CONTENT_MAX = 2000;
const PREVIEW_MAX_LINES = 25;
const PREVIEW_MAX_CHARS = 1900;

function truncate(str, max) {
  const s = String(str ?? '');
  if (s.length <= max) return s;
  return s.slice(0, max - 1) + '…';
}

function normalizeTitle(title) {
  return String(title ?? '').trim().toLowerCase();
}

function classifyThreads(sourceThreads, destTitleSet) {
  const sorted = [...sourceThreads].sort(
    (a, b) => a.createdTimestamp - b.createdTimestamp
  );
  const toRepost = [];
  const duplicates = [];
  for (const thread of sorted) {
    if (destTitleSet.has(normalizeTitle(thread.name))) {
      duplicates.push(thread);
    } else {
      toRepost.push(thread);
    }
  }
  return { toRepost, duplicates };
}

function collectAttachmentUrls(starterMessage) {
  if (!starterMessage || !starterMessage.attachments) return [];
  return [...starterMessage.attachments.values()].map((a) => a.url);
}

function buildForumThreadPayload(title, content, attachmentUrls) {
  const name = truncate(String(title ?? '').trim() || 'Untitled', THREAD_NAME_MAX);
  let body = truncate(content, MESSAGE_CONTENT_MAX);
  const files = [...attachmentUrls];
  if (!body && files.length === 0) {
    body = name;
  }
  return { name, message: { content: body, files } };
}

function buildPreview(items, duplicateCount) {
  if (items.length === 0) {
    return duplicateCount > 0
      ? `Nothing new to repost — ${duplicateCount} already exist as duplicate(s).`
      : 'Nothing new to repost.';
  }

  const header =
    `**${items.length}** post(s) to repost` +
    (duplicateCount > 0 ? `, **${duplicateCount}** skipped as duplicate(s)` : '') +
    ':';

  const lines = [];
  let shown = 0;
  for (const item of items) {
    if (shown >= PREVIEW_MAX_LINES) break;
    const t = truncate(String(item.title ?? '').trim() || 'Untitled', 80);
    const n = item.attachmentCount;
    lines.push(`• ${t} (${n} image${n === 1 ? '' : 's'})`);
    shown++;
  }

  const remaining = items.length - shown;
  let body = [header, ...lines].join('\n');
  if (remaining > 0) body += `\n…and ${remaining} more`;
  if (body.length > PREVIEW_MAX_CHARS) {
    body = body.slice(0, PREVIEW_MAX_CHARS - 1) + '…';
  }
  return body;
}

module.exports = {
  normalizeTitle,
  classifyThreads,
  collectAttachmentUrls,
  buildForumThreadPayload,
  buildPreview,
};
