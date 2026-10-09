/**
 * The core is format-blind (implementation plan rule 4, contract section 14): no file under this
 * folder outside `formats/` may contain a word that names a format or its SDK, in an identifier,
 * a string, a key, a comment, an import or a path.
 *
 * The forbidden words are never written here. They come from the packs themselves: every
 * `formats/<name>/` folder contributes its own name, the dash-separated parts of that name, and
 * the words in its `vocabulary.json` (which the pack also exports as `Pack.vocabulary`).
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

interface Violation {
  file: string;
  word: string;
  line: number;
}

function forbiddenWords(coreRoot: string): string[] {
  const formatsDir = path.join(coreRoot, 'formats');
  if (!fs.existsSync(formatsDir)) return [];
  const words = new Set<string>();
  for (const name of fs.readdirSync(formatsDir)) {
    const dir = path.join(formatsDir, name);
    if (!fs.statSync(dir).isDirectory()) continue;
    words.add(name.toLowerCase());
    for (const part of name.split('-'))
      if (part.length >= 3) words.add(part.toLowerCase());
    const vocabularyFile = path.join(dir, 'vocabulary.json');
    if (!fs.existsSync(vocabularyFile))
      throw new Error(
        `pack folder ${name} has no vocabulary.json naming its format words`
      );
    const vocabulary = JSON.parse(fs.readFileSync(vocabularyFile, 'utf8'));
    if (!Array.isArray(vocabulary) || !vocabulary.length)
      throw new Error(`${vocabularyFile} must be a non-empty array of words`);
    for (const word of vocabulary) words.add(String(word).toLowerCase());
  }
  return [...words].sort();
}

function coreFiles(coreRoot: string): string[] {
  const out: string[] = [];
  const rec = (dir: string) => {
    for (const entry of fs.readdirSync(dir)) {
      const full = path.join(dir, entry);
      if (full === path.join(coreRoot, 'formats')) continue;
      if (fs.statSync(full).isDirectory()) rec(full);
      else out.push(full);
    }
  };
  rec(coreRoot);
  return out;
}

function violations(coreRoot: string): Violation[] {
  const words = forbiddenWords(coreRoot);
  const found: Violation[] = [];
  for (const file of coreFiles(coreRoot)) {
    const rel = path.relative(coreRoot, file);
    for (const word of words)
      if (rel.toLowerCase().includes(word))
        found.push({ file: rel, word, line: 0 });
    fs.readFileSync(file, 'utf8')
      .split('\n')
      .forEach((text, i) => {
        const lower = text.toLowerCase();
        for (const word of words)
          if (lower.includes(word))
            found.push({ file: rel, word, line: i + 1 });
      });
  }
  return found;
}

function makeTree(files: Record<string, string>): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'core-names-'));
  for (const [rel, text] of Object.entries(files)) {
    const full = path.join(root, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, text);
  }
  return root;
}

describe('the core names no format', () => {
  it('finds no format word in any core file or path', () => {
    expect(violations(__dirname)).toEqual([]);
  });

  it('catches a pack name, a name part and a vocabulary word (true positive)', () => {
    const root = makeTree({
      'formats/acme-binary/vocabulary.json': '["AcmeKit"]',
      'formats/acme-binary/index.ts': 'export const ok = "acme-binary";',
      'verbs.ts': '// handles Acme documents\nconst x = 1;',
      'session.ts': "import { Editor } from '@vendor/acmekit-editor';",
      'acme/helper.ts': 'export {};'
    });
    expect(violations(root)).toEqual(
      expect.arrayContaining([
        { file: 'verbs.ts', word: 'acme', line: 1 },
        { file: 'session.ts', word: 'acmekit', line: 1 },
        { file: path.join('acme', 'helper.ts'), word: 'acme', line: 0 }
      ])
    );
    expect(violations(root).some((v) => v.file.startsWith('formats'))).toBe(
      false
    );
  });

  it('passes a clean core beside a pack (true negative)', () => {
    const root = makeTree({
      'formats/acme-binary/vocabulary.json': '["AcmeKit"]',
      'formats/acme-binary/index.ts': 'export const name = "acme-binary";',
      'verbs.ts': 'export const verbs = ["outline", "read", "find", "write"];'
    });
    expect(violations(root)).toEqual([]);
  });

  it('refuses a pack folder that does not declare its vocabulary', () => {
    const root = makeTree({ 'formats/acme-binary/index.ts': 'export {};' });
    expect(() => violations(root)).toThrow(/vocabulary\.json/);
  });
});
