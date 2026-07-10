const sharp = require('sharp');

// Progressive quality/size steps, highest quality first. We only ever step down
// far enough to make a post's images fit, so quality is preserved when possible.
const SETTINGS = [
  { quality: 92, maxDim: 4096 },
  { quality: 88, maxDim: 3600 },
  { quality: 82, maxDim: 3200 },
  { quality: 78, maxDim: 2800 },
  { quality: 72, maxDim: 2560 },
  { quality: 66, maxDim: 2048 },
  { quality: 58, maxDim: 1600 },
];

function toWebpName(name) {
  const base = String(name || 'image').replace(/\.[^./\\]+$/, '');
  return `${base || 'image'}.webp`;
}

// Re-encode an image buffer to WebP at the given quality and max dimension,
// honoring EXIF orientation and keeping animation (GIF -> animated WebP).
async function encodeWebp(buffer, { quality, maxDim }) {
  return sharp(buffer, { failOn: 'none', animated: true })
    .rotate()
    .resize({ width: maxDim, height: maxDim, fit: 'inside', withoutEnlargement: true })
    .webp({ quality, effort: 4 })
    .toBuffer();
}

const totalBytes = (files) => files.reduce((sum, f) => sum + f.attachment.length, 0);

// Given downloaded attachments ([{ buffer, name, isImage }]), return a set of
// files ({ attachment, name }) whose combined size fits within `budget`.
// - If the originals already fit, they are returned untouched (no quality loss).
// - Otherwise images are re-encoded to WebP, stepping down quality/size only as
//   far as needed. Non-image attachments cannot be shrunk and pass through.
// Returns { files, fits, compressed }.
async function compressToFit(items, budget) {
  const originals = items.map((i) => ({ attachment: i.buffer, name: i.name }));
  if (totalBytes(originals) <= budget) {
    return { files: originals, fits: true, compressed: false };
  }

  const images = items.filter((i) => i.isImage);
  const passthrough = items
    .filter((i) => !i.isImage)
    .map((i) => ({ attachment: i.buffer, name: i.name }));
  const imageBudget = budget - totalBytes(passthrough);

  if (images.length === 0 || imageBudget <= 0) {
    return { files: originals, fits: false, compressed: false };
  }

  let encoded = null;
  for (const opt of SETTINGS) {
    encoded = await Promise.all(
      images.map(async (i) => ({
        attachment: await encodeWebp(i.buffer, opt),
        name: toWebpName(i.name),
      }))
    );
    if (totalBytes(encoded) <= imageBudget) {
      return { files: [...encoded, ...passthrough], fits: true, compressed: true };
    }
  }

  // Smallest we could achieve; may still exceed budget (caller falls back).
  const files = [...encoded, ...passthrough];
  return { files, fits: totalBytes(files) <= budget, compressed: true };
}

module.exports = { toWebpName, encodeWebp, compressToFit };
