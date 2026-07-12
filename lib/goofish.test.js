const test = require('node:test');
const assert = require('node:assert');
const { normalizeGoofishLinks, itemIdFromUrl } = require('./goofish');

const SSR =
  'https://ssr.m.goofish.com/wow/moyu/moyu-project/fish-detail/pages/home?x-ssr=true&uniapp_id=1012562&uniapp_page=detail-ssr&id=1058488603283&spm=widle.12011849.0.0';
const H5 =
  'https://h5.m.goofish.com/item?forceFlush=1&itemId=1037368514320&hitNativeDetail=true&xy_refer=%7B"campaignId"%3A1119%7D&id=1037368514320&from_kun_share=default&spm=a2159r.13376460.0.0&tk=11BPgp0GnLx&app=chrome';
const WWW =
  'https://www.goofish.com/item?spm=a21ybx.search.searchFeedList.16.37262d1d5AB9xV&id=1041938627598&categoryId=126860474';

test('itemIdFromUrl prefers id, falls back to itemId', () => {
  assert.strictEqual(itemIdFromUrl(SSR), '1058488603283');
  assert.strictEqual(itemIdFromUrl(H5), '1037368514320');
  assert.strictEqual(itemIdFromUrl(WWW), '1041938627598');
  assert.strictEqual(
    itemIdFromUrl('https://h5.m.goofish.com/item?forceFlush=1&itemId=834760389770&x=1'),
    '834760389770'
  );
  assert.strictEqual(itemIdFromUrl('https://h5.m.goofish.com/item?spm=abc'), null);
});

test('normalizeGoofishLinks converts each supported form', () => {
  assert.deepStrictEqual(normalizeGoofishLinks(SSR), [
    'https://h5.m.goofish.com/item?id=1058488603283',
  ]);
  assert.deepStrictEqual(normalizeGoofishLinks(H5), [
    'https://h5.m.goofish.com/item?id=1037368514320',
  ]);
  assert.deepStrictEqual(normalizeGoofishLinks(WWW), [
    'https://h5.m.goofish.com/item?id=1041938627598',
  ]);
});

test('normalizeGoofishLinks handles many links in one message', () => {
  const text = `check these out\n${SSR}\n${H5}\nand ${WWW} thanks`;
  assert.deepStrictEqual(normalizeGoofishLinks(text), [
    'https://h5.m.goofish.com/item?id=1058488603283',
    'https://h5.m.goofish.com/item?id=1037368514320',
    'https://h5.m.goofish.com/item?id=1041938627598',
  ]);
});

test('normalizeGoofishLinks de-duplicates by listing id', () => {
  // h5 links carry the same id in both id= and itemId=; must not double-count.
  assert.deepStrictEqual(normalizeGoofishLinks(`${H5}\n${H5}`), [
    'https://h5.m.goofish.com/item?id=1037368514320',
  ]);
});

test('normalizeGoofishLinks ignores non-goofish and idless links', () => {
  assert.deepStrictEqual(normalizeGoofishLinks('hello world, no links here'), []);
  assert.deepStrictEqual(
    normalizeGoofishLinks('https://example.com/item?id=123 and https://goofish.com/foo'),
    []
  );
});

test('normalizeGoofishLinks is not fooled by lookalike hostnames', () => {
  assert.deepStrictEqual(
    normalizeGoofishLinks('https://notgoofish.com.evil.example/item?id=999'),
    []
  );
});
