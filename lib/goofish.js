// Goofish (闲鱼) listing links come in several bloated forms — ssr.m.goofish.com
// SSR pages, h5.m.goofish.com share links stuffed with tracking params, and
// www.goofish.com desktop links. They all carry the numeric listing id in an
// `id=` (and often `itemId=`) query param. We normalize any of them to the
// short canonical form so a channel stays tidy.

const CANONICAL_PREFIX = 'https://h5.m.goofish.com/item?id=';

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

module.exports = { normalizeGoofishLinks, itemIdFromUrl, CANONICAL_PREFIX };
