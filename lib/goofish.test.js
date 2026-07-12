const test = require('node:test');
const assert = require('node:assert');
const {
  normalizeGoofishLinks,
  extractGoofishLinks,
  isTaobaoShareUrl,
  itemIdFromUrl,
} = require('./goofish');

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

// A fake page body as returned by an m.tb.cn share link, embedding the real
// goofish URL the way the live redirector does.
const sharePage = (id) =>
  `<html><script>var url="https://h5.m.goofish.com/item?forceFlush=1&itemId=${id}&id=${id}&spm=a2159r";location.replace(url)</script></html>`;

test('extractGoofishLinks resolves m.tb.cn share links via fetch', async () => {
  const pages = {
    'https://m.tb.cn/h.Rzszqb6?tk=11BPgp0GnLx': sharePage('1037368514320'),
    'https://m.tb.cn/h.RBwyc45?tk=SS0zgp0wAFx': sharePage('834760389770'),
  };
  const fakeFetch = async (url) => ({ text: async () => pages[url] });
  const text =
    '【闲鱼】https://m.tb.cn/h.Rzszqb6?tk=11BPgp0GnLx CZ009 「x」\n' +
    '【闲鱼】https://m.tb.cn/h.RBwyc45?tk=SS0zgp0wAFx MF278 「y」';
  assert.deepStrictEqual(await extractGoofishLinks(text, fakeFetch), [
    'https://h5.m.goofish.com/item?id=1037368514320',
    'https://h5.m.goofish.com/item?id=834760389770',
  ]);
});

test('extractGoofishLinks mixes direct and share links, de-duped by id', async () => {
  const fakeFetch = async () => ({ text: async () => sharePage('1041938627598') });
  // Direct www link + a share link that resolves to the same id -> one result.
  const text = `${WWW}\nhttps://m.tb.cn/h.abc?tk=zzz`;
  assert.deepStrictEqual(await extractGoofishLinks(text, fakeFetch), [
    'https://h5.m.goofish.com/item?id=1041938627598',
  ]);
});

test('extractGoofishLinks resolves 302 redirect with Location header', async () => {
  // Simulate m.tb.cn responding with a 302 redirect to a goofish URL
  // instead of inline HTML (this was the root cause of skipped links).
  const fakeFetch = async () => ({
    status: 302,
    headers: {
      get: (k) =>
        k.toLowerCase() === 'location'
          ? 'https://h5.m.goofish.com/item?forceFlush=1&itemId=1064964837294&id=1064964837294&spm=a2159r'
          : null,
    },
    text: async () => '',
  });
  const text = '【闲鱼】https://m.tb.cn/h.RApXk8g?tk=23c6gpyyIvc HU108 「快来捡漏」';
  assert.deepStrictEqual(await extractGoofishLinks(text, fakeFetch), [
    'https://h5.m.goofish.com/item?id=1064964837294',
  ]);
});

test('extractGoofishLinks handles 302 redirect + body links without duplicates', async () => {
  // Some servers might put the URL in both the Location header AND the body.
  const fakeFetch = async () => ({
    status: 302,
    headers: {
      get: (k) =>
        k.toLowerCase() === 'location'
          ? 'https://h5.m.goofish.com/item?id=999888777666'
          : null,
    },
    text: async () => sharePage('999888777666'),
  });
  const text = 'https://m.tb.cn/h.test?tk=abc';
  const result = await extractGoofishLinks(text, fakeFetch);
  assert.deepStrictEqual(result, [
    'https://h5.m.goofish.com/item?id=999888777666',
  ]);
});

test('extractGoofishLinks handles 301 redirect without body', async () => {
  const fakeFetch = async () => ({
    status: 301,
    headers: {
      get: (k) =>
        k.toLowerCase() === 'location'
          ? 'https://h5.m.goofish.com/item?id=1111222233334'
          : k.toLowerCase() === 'content-type'
            ? 'text/html'
            : null,
    },
    text: async () => '',
  });
  const text = 'https://m.tb.cn/h.redirect?tk=xyz';
  assert.deepStrictEqual(await extractGoofishLinks(text, fakeFetch), [
    'https://h5.m.goofish.com/item?id=1111222233334',
  ]);
});

test('isTaobaoShareUrl allows only exact Taobao hosts over https', () => {
  assert.strictEqual(isTaobaoShareUrl('https://m.tb.cn/h.8ZdIii5?tk=q'), true);
  assert.strictEqual(isTaobaoShareUrl('https://tb.cn/h.abc'), true);
  // SSRF vectors that a substring match would have let through:
  assert.strictEqual(isTaobaoShareUrl('https://169.254.169.254/?x=.tb.cn/'), false);
  assert.strictEqual(isTaobaoShareUrl('https://m.tb.cn.evil.example/x'), false);
  assert.strictEqual(isTaobaoShareUrl('https://evil.example/tb.cn/x'), false);
  assert.strictEqual(isTaobaoShareUrl('https://user:pass@m.tb.cn/x'), false);
  assert.strictEqual(isTaobaoShareUrl('https://m.tb.cn:8080/x'), false);
  assert.strictEqual(isTaobaoShareUrl('http://m.tb.cn/x'), false); // not https
  assert.strictEqual(isTaobaoShareUrl('file:///etc/passwd'), false);
});

test('extractGoofishLinks never fetches a non-allowlisted host (SSRF guard)', async () => {
  const fakeFetch = async (url) => {
    throw new Error(`must not fetch ${url}`);
  };
  const text =
    'https://169.254.169.254/?x=.tb.cn/ https://m.tb.cn.evil.example/latest/meta';
  assert.deepStrictEqual(await extractGoofishLinks(text, fakeFetch), []);
});

test('extractGoofishLinks skips share links that fail to fetch', async () => {
  const fakeFetch = async () => {
    throw new Error('network down');
  };
  const text = `${SSR}\nhttps://m.tb.cn/h.dead?tk=zzz`;
  // The direct link still comes through; the unreachable share link is dropped.
  assert.deepStrictEqual(await extractGoofishLinks(text, fakeFetch), [
    'https://h5.m.goofish.com/item?id=1058488603283',
  ]);
});

// Response mock with a headers.get() and a text() body, no stream.
const mockRes = (html, headers = {}) => {
  const lower = Object.fromEntries(
    Object.entries(headers).map(([k, v]) => [k.toLowerCase(), String(v)])
  );
  return { headers: { get: (k) => lower[k.toLowerCase()] ?? null }, text: async () => html };
};

test('extractGoofishLinks rejects an over-cap Content-Length', async () => {
  const fakeFetch = async () =>
    mockRes(sharePage('1037368514320'), { 'content-length': String(50 * 1024 * 1024) });
  const out = await extractGoofishLinks('https://m.tb.cn/h.big?tk=z', fakeFetch);
  assert.deepStrictEqual(out, []);
});

test('extractGoofishLinks rejects a non-HTML content type', async () => {
  const fakeFetch = async () =>
    mockRes(sharePage('1037368514320'), { 'content-type': 'application/octet-stream' });
  const out = await extractGoofishLinks('https://m.tb.cn/h.bin?tk=z', fakeFetch);
  assert.deepStrictEqual(out, []);
});

test('extractGoofishLinks accepts a declared text/html body under the cap', async () => {
  const fakeFetch = async () =>
    mockRes(sharePage('1037368514320'), {
      'content-type': 'text/html; charset=utf-8',
      'content-length': '1024',
    });
  const out = await extractGoofishLinks('https://m.tb.cn/h.ok?tk=z', fakeFetch);
  assert.deepStrictEqual(out, ['https://h5.m.goofish.com/item?id=1037368514320']);
});
