const test = require('node:test');
const assert = require('node:assert');
const {
  normalizeTitle,
  classifyThreads,
  collectAttachments,
  chunkAttachments,
  buildForumThreadPayload,
  buildPreview,
} = require('./repost');

test('normalizeTitle trims and lowercases', () => {
  assert.strictEqual(normalizeTitle('  Hello World  '), 'hello world');
  assert.strictEqual(normalizeTitle('CAPS'), 'caps');
  assert.strictEqual(normalizeTitle(null), '');
});

test('classifyThreads sorts oldest first and splits duplicates', () => {
  const threads = [
    { name: 'B', createdTimestamp: 200 },
    { name: 'A', createdTimestamp: 100 },
    { name: 'Dup', createdTimestamp: 300 },
  ];
  const dest = new Set(['dup']);
  const { toRepost, duplicates } = classifyThreads(threads, dest);
  assert.deepStrictEqual(toRepost.map((t) => t.name), ['A', 'B']);
  assert.deepStrictEqual(duplicates.map((t) => t.name), ['Dup']);
});

test('collectAttachments maps url and size', () => {
  const starter = {
    attachments: new Map([
      ['1', { url: 'https://cdn/x.png', size: 5 }],
      ['2', { url: 'https://cdn/y.png', size: 7 }],
    ]),
  };
  assert.deepStrictEqual(collectAttachments(starter), [
    { url: 'https://cdn/x.png', size: 5 },
    { url: 'https://cdn/y.png', size: 7 },
  ]);
  assert.deepStrictEqual(collectAttachments(null), []);
});

test('chunkAttachments packs by size budget', () => {
  const a = [
    { url: '1', size: 10 },
    { url: '2', size: 10 },
    { url: '3', size: 5 },
  ];
  const chunks = chunkAttachments(a, 20, 10);
  assert.deepStrictEqual(
    chunks.map((c) => c.map((x) => x.url)),
    [['1', '2'], ['3']]
  );
});

test('chunkAttachments caps by count', () => {
  const a = Array.from({ length: 12 }, (_, i) => ({ url: String(i), size: 1 }));
  const chunks = chunkAttachments(a, 1000, 10);
  assert.strictEqual(chunks.length, 2);
  assert.strictEqual(chunks[0].length, 10);
  assert.strictEqual(chunks[1].length, 2);
});

test('chunkAttachments isolates a single oversize file', () => {
  const a = [
    { url: 'big', size: 999 },
    { url: 'small', size: 1 },
  ];
  const chunks = chunkAttachments(a, 100, 10);
  assert.deepStrictEqual(
    chunks.map((c) => c.map((x) => x.url)),
    [['big'], ['small']]
  );
});

test('buildForumThreadPayload truncates name to 100 and keeps files', () => {
  const p = buildForumThreadPayload('x'.repeat(120), 'body', ['u1']);
  assert.strictEqual(p.name.length, 100);
  assert.strictEqual(p.message.content, 'body');
  assert.deepStrictEqual(p.message.files, ['u1']);
});

test('buildForumThreadPayload falls back to title when no content and no files', () => {
  const p = buildForumThreadPayload('Title', '', []);
  assert.strictEqual(p.message.content, 'Title');
});

test('buildForumThreadPayload truncates content to 2000', () => {
  const p = buildForumThreadPayload('t', 'y'.repeat(2500), []);
  assert.strictEqual(p.message.content.length, 2000);
});

test('buildPreview lists items and duplicate count', () => {
  const items = [
    { title: 'A', attachmentCount: 2 },
    { title: 'B', attachmentCount: 0 },
  ];
  const out = buildPreview(items, 3);
  assert.match(out, /A \(2 images\)/);
  assert.match(out, /B \(0 images\)/);
  assert.match(out, /3.*duplicate/i);
});

test('buildPreview handles empty list', () => {
  assert.match(buildPreview([], 0), /Nothing new/i);
});

test('buildPreview caps long lists with a "more" line', () => {
  const items = Array.from({ length: 40 }, (_, i) => ({ title: 'T' + i, attachmentCount: 1 }));
  const out = buildPreview(items, 0);
  assert.match(out, /and \d+ more/);
});
