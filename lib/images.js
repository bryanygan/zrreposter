const sharp = require('sharp');

// Progressive quality/size steps, highest quality first. We only ever step down
// far enough to make a post's images fit, so quality is preserved when possible.
const SETTINGS = [
  { quality: 90, maxDim: 4096 },
  { quality: 86, maxDim: 3600 },
  { quality: 82, maxDim: 3200 },
  { quality: 78, maxDim: 2800 },
  { quality: 72, maxDim: 2560 },
  { quality: 66, maxDim: 2048 },
  { quality: 58, maxDim: 1600 },
];

function toJpegName(name) {
  const base = String(name || 'image').replace(/\.[^./\\]+$/, '');
  return `${base || 'image'}.jpg`;
}

// Re-encode an image to progressive mozjpeg at the given quality and max
// dimension, honoring EXIF orientation. JPEG is used (not WebP) because Discord
// tags animated-WebP as "GIF", which hides the forum preview image.
async function encodeJpeg(buffer, { quality, maxDim }) {
  return sharp(buffer, { failOn: 'none' })
    .rotate()
    .resize({ width: maxDim, height: maxDim, fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality, mozjpeg: true, chromaSubsampling: '4:2:0' })
    .toBuffer();
}

const totalBytes = (files) => files.reduce((sum, f) => sum + f.attachment.length, 0);

// True for attachments we can shrink by re-encoding. Real GIFs are excluded so
// their animation isn't flattened; they pass through as-is.
const isCompressible = (item) => item.isImage && !item.isGif;

// Encode a whole set of attachments at one quality/size setting, preserving
// order. Compressible images become JPEG; GIFs and non-images pass through.
async function encodeAll(items, opt) {
  return Promise.all(
    items.map(async (item) =>
      isCompressible(item)
        ? { attachment: await encodeJpeg(item.buffer, opt), name: toJpegName(item.name) }
        : { attachment: item.buffer, name: item.name }
    )
  );
}

// Given downloaded attachments ([{ buffer, name, isImage, isGif }]), return a
// set of files ({ attachment, name }) whose combined size fits within `budget`.
// - If the originals already fit, they are returned untouched (no quality loss).
// - Otherwise images are re-encoded to JPEG, stepping down quality/size only as
//   far as needed. GIFs and non-images cannot be shrunk and pass through.
// Returns { files, fits, compressed }.
async function compressToFit(items, budget) {
  const originals = items.map((i) => ({ attachment: i.buffer, name: i.name }));
  if (totalBytes(originals) <= budget) {
    return { files: originals, fits: true, compressed: false };
  }

  if (!items.some(isCompressible)) {
    return { files: originals, fits: false, compressed: false };
  }

  let encoded = null;
  for (const opt of SETTINGS) {
    encoded = await encodeAll(items, opt);
    if (totalBytes(encoded) <= budget) {
      return { files: encoded, fits: true, compressed: true };
    }
  }

  // Smallest we could achieve; may still exceed budget (caller falls back).
  return { files: encoded, fits: totalBytes(encoded) <= budget, compressed: true };
}

module.exports = { toJpegName, encodeJpeg, compressToFit };
