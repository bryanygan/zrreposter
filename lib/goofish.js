// Goofish (闲鱼) listing links come in several bloated forms — ssr.m.goofish.com
// SSR pages, h5.m.goofish.com share links stuffed with tracking params, and
// www.goofish.com desktop links. They all carry the numeric listing id in an
// `id=` (and often `itemId=`) query param. We normalize any of them to the
// short canonical form so a channel stays tidy.

const CANONICAL_PREFIX = 'https://h5.m.goofish.com/item?id=';

// Taobao share links (m.tb.cn/h.XXXX?tk=YYYY) don't contain the listing id —
// they're a redirector whose page embeds the real goofish URL. We fetch them
// with a mobile UA and extract the id from the returned HTML.
const TAOBAO_SHARE_RE = /(^|\.)tb\.cn\//i;
const MOBILE_USER_AGENT =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15';
const RESOLVE_TIMEOUT_MS = 10000;

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

// Fetch a Taobao share link and pull the canonical goofish link(s) out of the
// page it points at. Returns [] if the link can't be reached or parsed.
async function resolveTaobaoShareLink(url, fetchImpl) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), RESOLVE_TIMEOUT_MS);
  try {
    const res = await fetchImpl(url, {
      headers: { 'User-Agent': MOBILE_USER_AGENT },
      redirect: 'follow',
      signal: controller.signal,
    });
    const html = await res.text();
    return normalizeGoofishLinks(html);
  } catch {
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
  const seen = new Set();
  const out = [];
  const add = (link) => {
    const id = link.slice(CANONICAL_PREFIX.length);
    if (seen.has(id)) return;
    seen.add(id);
    out.push(link);
  };

  for (const token of tokens) {
    if (/(^|\.)goofish\.com/i.test(token)) {
      normalizeGoofishLinks(token).forEach(add);
    } else if (TAOBAO_SHARE_RE.test(token)) {
      (await resolveTaobaoShareLink(token, fetchImpl)).forEach(add);
    }
  }
  return out;
}

module.exports = {
  normalizeGoofishLinks,
  extractGoofishLinks,
  itemIdFromUrl,
  CANONICAL_PREFIX,
};
