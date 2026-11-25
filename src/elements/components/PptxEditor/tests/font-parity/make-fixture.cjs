// Retain original bytes; no presentation authoring or font conversion.
const fs = require('fs');
const path = require('path');
const { createHash } = require('crypto');
const { unzipSync, zipSync } = require('fflate');
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const dir = path.join(__dirname, '../fixtures');
const expected = JSON.parse(
  fs.readFileSync(path.join(dir, 'marketing-fonts.json'), 'utf8')
);
if (!process.argv[2])
  throw new Error('Pass the original presentation-2.pptx path.');
const source = fs.readFileSync(process.argv[2]);
if (hash(source) !== expected.sourceSha256)
  throw new Error('Source SHA256 differs from the reviewed PowerPoint deck.');
const retained = {};
const fontParts = {};
for (const [name, bytes] of Object.entries(unzipSync(source))) {
  if (
    /\.(xml|rels)$/.test(name) ||
    (name.startsWith('ppt/fonts/') && !name.endsWith('/'))
  ) {
    retained[name] = [bytes, { mtime: new Date(2026, 9, 19) }];
    if (name.startsWith('ppt/fonts/')) fontParts[name] = hash(bytes);
  }
}
if (JSON.stringify(fontParts) !== JSON.stringify(expected.fontParts))
  throw new Error('Font parts differ from the manifest.');
fs.writeFileSync(
  path.join(dir, 'marketing-fonts.pptx'),
  zipSync(retained, { level: 6 })
);
