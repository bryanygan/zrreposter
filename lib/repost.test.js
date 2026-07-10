const test = require('node:test');
const assert = require('node:assert');
const {
  normalizeTitle,
  classifyThreads,
  collectAttachmentUrls,
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

test('collectAttachmentUrls maps attachment urls', () => {
  const starter = {
    attachments: new Map([
      ['1', { url: 'https://cdn/x.png' }],
      ['2', { url: 'https://cdn/y.png' }],
    ]),
  };
  assert.deepStrictEqual(collectAttachmentUrls(starter), [
    'https://cdn/x.png',
    'https://cdn/y.png',
  ]);
  assert.deepStrictEqual(collectAttachmentUrls(null), []);
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
