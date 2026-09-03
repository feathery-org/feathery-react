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

/**
 * The full local corpus, including client content. Absent in CI.
 *
 * Overridable with DOCX_LOCAL_CORPUS so this is not one engineer's home
 * directory baked into a shared test file; the literal below stays as the
 * documented default because that is where it actually lives today.
 *
 * Note what is NOT read from here: the `browser-only/` subdirectory. Shapes in
 * it are captured documents that cannot be opened under jsdom. Measured
 * 2026-08-27, same probe and same harness, only the file differing:
 * `headings-bound` imports and serializes in 1.5s, while
 * `browser-only/headers-footers` never completes - killed at 150s after an
 * earlier run was killed at 600s. Vendoring such a shape into the CI corpus
 * would hang the suite rather than widen it, so those shapes are reachable only
 * from browser-driven tests.
 */
export const LOCAL_CORPUS =
  process.env.DOCX_LOCAL_CORPUS ??
  '/Users/faizalsomani/Desktop/docx-test-corpus/sfdt';

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

/**
 * The shape named, or a loud failure.
 *
 * `corpusShapes().find(...)` returning undefined and a `??` chain quietly
 * substituting a different document is how a test comes to assert something
 * about a shape it never loaded: the relocation header-conservation row spent
 * its life comparing one shape's empty `headersFooters` to itself and passing
 * for that reason. A missing shape is a broken test, not a fallback, so it
 * throws and names what IS available.
 */
export function requireShape(name: string): CorpusShape {
  const shapes = corpusShapes();
  const found = shapes.find((s) => s.name === name);
  if (found) return found;
  throw new Error(
    `corpus shape ${JSON.stringify(name)} is not available. ` +
      `Present: ${shapes.map((s) => s.name).join(', ')}. ` +
      `A test must not silently fall back to a different shape.`
  );
}
