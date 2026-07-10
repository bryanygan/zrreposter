const test = require('node:test');
const assert = require('node:assert');
const sharp = require('sharp');
const { toWebpName, compressToFit } = require('./images');

// A noisy (incompressible) image so PNG originals are genuinely large.
async function noisyPng(width, height) {
  const raw = Buffer.allocUnsafe(width * height * 3);
  for (let i = 0; i < raw.length; i++) raw[i] = Math.floor(Math.random() * 256);
  return sharp(raw, { raw: { width, height, channels: 3 } }).png().toBuffer();
}

test('toWebpName swaps the extension', () => {
  assert.strictEqual(toWebpName('photo.JPG'), 'photo.webp');
  assert.strictEqual(toWebpName('no-ext'), 'no-ext.webp');
  assert.strictEqual(toWebpName(null), 'image.webp');
});

test('compressToFit returns originals untouched when they already fit', async () => {
  const small = await sharp({
    create: { width: 16, height: 16, channels: 3, background: { r: 1, g: 2, b: 3 } },
  })
    .png()
    .toBuffer();
  const items = [{ buffer: small, name: 'a.png', isImage: true }];
  const res = await compressToFit(items, 10 * 1024 * 1024);
  assert.strictEqual(res.compressed, false);
  assert.strictEqual(res.fits, true);
  assert.strictEqual(res.files[0].attachment, small);
  assert.strictEqual(res.files[0].name, 'a.png');
});

test('compressToFit shrinks oversized images to fit the budget', async () => {
  const big = await noisyPng(1400, 1400);
  const items = [
    { buffer: big, name: 'one.png', isImage: true },
    { buffer: big, name: 'two.png', isImage: true },
  ];
  const budget = 3 * 1024 * 1024; // below the ~11.8 MB originals, forces compression
  const res = await compressToFit(items, budget);
  assert.strictEqual(res.compressed, true);
  assert.strictEqual(res.fits, true);
  assert.ok(
    res.files.reduce((s, f) => s + f.attachment.length, 0) <= budget,
    'total must be within budget'
  );
  assert.ok(res.files.every((f) => f.name.endsWith('.webp')));
});
