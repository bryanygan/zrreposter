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

const DURATION_MS = {
  m: 60000, min: 60000, mins: 60000, minute: 60000, minutes: 60000,
  h: 3600000, hr: 3600000, hrs: 3600000, hour: 3600000, hours: 3600000,
  d: 86400000, day: 86400000, days: 86400000,
  w: 604800000, week: 604800000, weeks: 604800000,
};

const DEFAULT_TIMEZONE = 'America/New_York';

// Offset (timezone - UTC) in ms at the given instant, for the given IANA zone.
function tzOffsetMs(utcMs, tz) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(new Date(utcMs));
  const p = Object.fromEntries(parts.map((x) => [x.type, x.value]));
  const asIfUtc = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second);
  return asIfUtc - utcMs;
}

// The UTC timestamp for midnight wall-clock on the given date in the given zone,
// accounting for that date's DST offset (e.g. EDT vs EST).
function zonedMidnightToUtc(year, month, day, tz) {
  const naive = Date.UTC(year, month - 1, day);
  return naive - tzOffsetMs(naive, tz);
}

function parseDate(s, now, tz) {
  let year;
  let month;
  let day;
  let m;
  if ((m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/))) {
    [year, month, day] = [+m[1], +m[2], +m[3]];
  } else if ((m = s.match(/^(\d{1,2})\/(\d{1,2})(?:\/(\d{2}|\d{4}))?$/))) {
    [month, day] = [+m[1], +m[2]];
    if (m[3] === undefined) year = new Date(now).getUTCFullYear();
    else year = +m[3] < 100 ? 2000 + +m[3] : +m[3];
  } else {
    return null;
  }
  // Reject impossible dates (e.g. 02/30 would roll over to March).
  const check = new Date(Date.UTC(year, month - 1, day));
  if (check.getUTCMonth() !== month - 1 || check.getUTCDate() !== day) return null;
  return zonedMidnightToUtc(year, month, day, tz);
}

// Parse a "posted after" filter into a cutoff timestamp (ms). Accepts a
// duration relative to now ("50h", "2 days", "90 min") or an absolute date
// ("07/07", "07/07/2025", "2026-07-07"), where dates mean midnight in `tz`
// (default US Eastern). Returns null for empty input; throws on bad input.
function parseSince(input, now = Date.now(), tz = DEFAULT_TIMEZONE) {
  const s = String(input ?? '').trim();
  if (!s) return null;

  const dur = s.match(/^(\d+(?:\.\d+)?)\s*([a-z]+)$/i);
  if (dur && DURATION_MS[dur[2].toLowerCase()]) {
    return now - parseFloat(dur[1]) * DURATION_MS[dur[2].toLowerCase()];
  }

  const date = parseDate(s, now, tz);
  if (date !== null) return date;

  throw new Error(
    `Could not understand "${s}". Use a duration like "50h" or "2d", or a date like 07/07 or 2026-07-07.`
  );
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

function collectAttachments(starterMessage) {
  if (!starterMessage || !starterMessage.attachments) return [];
  return [...starterMessage.attachments.values()].map((a) => ({
    url: a.url,
    size: a.size ?? 0,
    name: a.name ?? null,
    contentType: a.contentType ?? null,
  }));
}

function isTooLargeError(err) {
  return err && (err.code === 40005 || err.status === 413);
}

// Upload a group of file URLs via sendFn(files). If Discord rejects the batch
// as too large (40005 / 413), recursively split it in half and retry, down to
// single files. A single file that is still too large is skipped. Returns the
// number of files skipped. Non-size errors propagate.
async function uploadInBatches(sendFn, files) {
  if (files.length === 0) return 0;
  try {
    await sendFn(files);
    return 0;
  } catch (err) {
    if (!isTooLargeError(err)) throw err;
    if (files.length === 1) return 1;
    const mid = Math.ceil(files.length / 2);
    const a = await uploadInBatches(sendFn, files.slice(0, mid));
    const b = await uploadInBatches(sendFn, files.slice(mid));
    return a + b;
  }
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
  parseSince,
  classifyThreads,
  collectAttachments,
  uploadInBatches,
  isTooLargeError,
  buildForumThreadPayload,
  buildPreview,
};
