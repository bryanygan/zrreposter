// Goofish (闲鱼) listing links come in several bloated forms — ssr.m.goofish.com
// SSR pages, h5.m.goofish.com share links stuffed with tracking params, and
// www.goofish.com desktop links. They all carry the numeric listing id in an
// `id=` (and often `itemId=`) query param. We normalize any of them to the
// short canonical form so a channel stays tidy.

const CANONICAL_PREFIX = 'https://h5.m.goofish.com/item?id=';

// Structured logger. Writes JSON lines to stdout/stderr so log aggregators can
// parse them. Set LOG_LEVEL=debug in the environment for verbose output.
const LOG_LEVELS = { debug: 0, info: 1, warn: 2, error: 3 };
const CURRENT_LOG_LEVEL = LOG_LEVELS[process.env.LOG_LEVEL?.toLowerCase()] ?? LOG_LEVELS.info;

function log(level, msg, extra = {}) {
  if (LOG_LEVELS[level] < CURRENT_LOG_LEVEL) return;
  const entry = { ts: new Date().toISOString(), level, module: 'goofish', msg, ...extra };
  const fn = level === 'error' || level === 'warn' ? console.error : console.log;
  fn(JSON.stringify(entry));
}

// Taobao share links (m.tb.cn/h.XXXX?tk=YYYY) don't contain the listing id —
// they're a redirector whose page embeds the real goofish URL. We fetch them
// with a mobile UA and extract the id from the returned HTML.
//
// Because the fetch target comes from arbitrary chat input, restrict it to an
// exact hostname allowlist to avoid SSRF: a substring check would let a token
// like `https://169.254.169.254/?x=.tb.cn/` (the metadata endpoint) through.
const TAOBAO_SHARE_HOSTS = new Set(['m.tb.cn', 'tb.cn']);
const MOBILE_USER_AGENT =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15';
const RESOLVE_TIMEOUT_MS = 10000;
// Share pages are a few tens of KB; cap the read so a hostile/huge response
// can't exhaust memory. The listing id always appears well within this.
const MAX_RESPONSE_BYTES = 1024 * 1024;
const HTML_CONTENT_TYPE_RE = /text\/html|application\/xhtml|text\/plain/i;

// Pull the listing id out of a single goofish URL token. Prefer `id`, falling
// back to `itemId`; both are present and identical on h5 share links.
function itemIdFromUrl(url) {
  const byId = url.match(/[?&]id=(\d+)/);
  if (byId) return byId[1];
  const byItemId = url.match(/[?&]itemId=(\d+)/);
  if (byItemId) return byItemId[1];
  return null;
}

// Find every goofish link in a block of text and return the canonical short
// form for each, de-duplicated while preserving first-seen order. Non-goofish
// text and links are ignored.
function normalizeGoofishLinks(text) {
  const tokens = String(text ?? '').match(/https?:\/\/[^\s<>]+/gi) || [];
  const seen = new Set();
  const links = [];
  for (const token of tokens) {
    if (!/(^|\.)goofish\.com/i.test(token)) continue;
    const id = itemIdFromUrl(token);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    links.push(CANONICAL_PREFIX + id);
  }
  return links;
}

// A share link is safe to fetch only if it parses to an https URL on an exact
// allowlisted Taobao host, with no userinfo and the default port. Anything else
// (internal IPs, lookalike hosts, credential-stuffed URLs) is not fetched.
function isTaobaoShareUrl(token) {
  let u;
  try {
    u = new URL(token);
  } catch {
    return false;
  }
  if (u.protocol !== 'https:') return false;
  if (u.username || u.password) return false;
  if (u.port !== '') return false; // non-default port
  const host = u.hostname.toLowerCase().replace(/\.$/, '');
  return TAOBAO_SHARE_HOSTS.has(host);
}

// Read a response body as text, but only up to maxBytes and only if it looks
// like HTML. Rejects (returns null) on a non-HTML content type or a declared
// Content-Length over the cap, and stops reading once the cap is reached so an
// oversized body can't be buffered whole.
async function readCappedHtml(res, maxBytes) {
  const type = res.headers?.get?.('content-type') || '';
  if (type && !HTML_CONTENT_TYPE_RE.test(type)) return null;
  const declared = Number(res.headers?.get?.('content-length'));
  if (Number.isFinite(declared) && declared > maxBytes) return null;

  const reader = res.body?.getReader?.();
  if (!reader) {
    // No stream (e.g. a test mock) — fall back to text() and cap in memory.
    const text = await res.text();
    return text.length > maxBytes ? text.slice(0, maxBytes) : text;
  }
  const chunks = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    chunks.push(Buffer.from(value));
    if (total >= maxBytes) {
      await reader.cancel().catch(() => {});
      break;
    }
  }
  return Buffer.concat(chunks).toString('utf8');
}

// Fetch an allowlisted Taobao share link and pull the canonical goofish link(s)
// out of the page it points at. Returns [] if the link can't be reached or
// parsed. Redirects are not followed (`manual`) so a 3xx can't bounce the
// request to an attacker-chosen host; instead we check the Location header on
// redirect responses for goofish URLs. The body is size-capped to bound memory.
async function resolveTaobaoShareLink(url, fetchImpl) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), RESOLVE_TIMEOUT_MS);
  try {
    log('debug', 'Resolving Taobao share link', { url });
    const res = await fetchImpl(url, {
      headers: { 'User-Agent': MOBILE_USER_AGENT },
      redirect: 'manual',
      signal: controller.signal,
    });
    log('debug', 'Taobao share link response', { url, status: res.status });

    // On a 3xx redirect, the Location header often contains the real goofish
    // URL (or another redirector that embeds it). Extract the id from there
    // before falling through to body parsing.
    const redirectLinks = [];
    if (res.status >= 300 && res.status < 400) {
      const location = res.headers?.get?.('location') || '';
      if (location) {
        log('debug', 'Redirect Location header found', { url, location });
        redirectLinks.push(...normalizeGoofishLinks(location));
      }
    }

    // Also try the response body — some share pages serve inline HTML that
    // embeds the destination URL rather than (or in addition to) redirecting.
    const html = await readCappedHtml(res, MAX_RESPONSE_BYTES);
    const bodyLinks = html ? normalizeGoofishLinks(html) : [];

    // Merge redirect + body links, de-duplicated by listing id.
    const seen = new Set();
    const merged = [];
    for (const link of [...redirectLinks, ...bodyLinks]) {
      const id = link.slice(CANONICAL_PREFIX.length);
      if (!seen.has(id)) {
        seen.add(id);
        merged.push(link);
      }
    }

    if (merged.length > 0) {
      log('info', 'Resolved Taobao share link', { url, resolved: merged });
    } else {
      log('warn', 'Taobao share link resolved to zero goofish links', {
        url,
        status: res.status,
        hasLocation: !!(res.headers?.get?.('location')),
        bodyLength: html?.length ?? 0,
      });
    }
    return merged;
  } catch (err) {
    log('error', 'Failed to resolve Taobao share link', {
      url,
      error: err.message,
    });
    return [];
  } finally {
    clearTimeout(timer);
  }
}

// Extract every goofish listing link from a message, canonicalized and
// de-duplicated by listing id. Direct goofish links are read inline; Taobao
// share links (m.tb.cn) are fetched via fetchImpl to resolve their target.
async function extractGoofishLinks(text, fetchImpl = fetch) {
  const tokens = String(text ?? '').match(/https?:\/\/[^\s<>]+/gi) || [];
  log('debug', 'Extracting goofish links', {
    tokenCount: tokens.length,
    tokens: tokens.map((t) => t.slice(0, 80)),
  });

  const seen = new Set();
  const out = [];
  const add = (link, source) => {
    const id = link.slice(CANONICAL_PREFIX.length);
    if (seen.has(id)) {
      log('debug', 'Skipping duplicate listing id', { id, source });
      return;
    }
    seen.add(id);
    out.push(link);
  };

  for (const token of tokens) {
    if (/(^|\.)goofish\.com/i.test(token)) {
      const direct = normalizeGoofishLinks(token);
      log('debug', 'Direct goofish link', { token: token.slice(0, 80), resolved: direct });
      direct.forEach((l) => add(l, 'direct'));
    } else if (isTaobaoShareUrl(token)) {
      const resolved = await resolveTaobaoShareLink(token, fetchImpl);
      resolved.forEach((l) => add(l, 'taobao-share'));
    } else {
      log('debug', 'Ignoring non-goofish/non-taobao token', { token: token.slice(0, 80) });
    }
  }

  log('info', 'Extraction complete', { inputTokens: tokens.length, outputLinks: out.length, links: out });
  return out;
}

module.exports = {
  normalizeGoofishLinks,
  extractGoofishLinks,
  isTaobaoShareUrl,
  itemIdFromUrl,
  CANONICAL_PREFIX,
};
