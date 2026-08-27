/**
 * Where the shape corpus comes from, for every sweep that runs over it.
 *
 * Two sources, and the difference is the point. The sixteen SYNTHETIC shapes are
 * vendored into the repo so the sweeps run in CI - they used to live only at an
 * absolute path on one machine, which meant the two tests with the best
 * defect-per-hour in this workstream ran nowhere but that laptop.
 *
 * The LOCAL corpus additionally holds `real-customer-template`, which is genuine
 * client content and is not vendored. A sweep gets it when it is present and
 * skips it when it is not, rather than failing - a missing client document is an
 * expected condition everywhere except this laptop.
 */
import * as fs from 'fs';
import * as path from 'path';

/** Vendored, always present, safe to require. */
export const VENDORED_CORPUS = path.join(__dirname, 'corpus');

/** The full local corpus, including client content. Absent in CI. */
export const LOCAL_CORPUS = '/Users/faizalsomani/Desktop/docx-test-corpus/sfdt';

export interface CorpusShape {
  name: string;
  file: string;
  /** True when this shape is only available locally (client content). */
  local: boolean;
}

/**
 * Every shape a sweep should run over: the vendored set always, plus anything
 * the local corpus adds on top when it happens to be there.
 */
export function corpusShapes(): CorpusShape[] {
  const shapes: CorpusShape[] = fs
    .readdirSync(VENDORED_CORPUS)
    .filter((f) => f.endsWith('.sfdt.json'))
    .sort()
    .map((file) => ({
      name: file.replace('.sfdt.json', ''),
      file: path.join(VENDORED_CORPUS, file),
      local: false
    }));

  if (!fs.existsSync(LOCAL_CORPUS)) return shapes;
  const seen = new Set(shapes.map((s) => s.name));
  for (const file of fs.readdirSync(LOCAL_CORPUS).sort()) {
    if (!file.endsWith('.sfdt.json')) continue;
    const name = file.replace('.sfdt.json', '');
    if (seen.has(name)) continue;
    shapes.push({ name, file: path.join(LOCAL_CORPUS, file), local: true });
  }
  return shapes;
}

export const readShape = (shape: CorpusShape): any =>
  JSON.parse(fs.readFileSync(shape.file, 'utf8'));
