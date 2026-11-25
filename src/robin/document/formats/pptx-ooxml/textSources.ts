import type { NfNode } from '../../tree';
import { leafRuns } from './tree';

export const RUN_FORMAT = [
  'bold',
  'italic',
  'underline',
  'strike',
  'size',
  'color',
  'highlight',
  'font'
] as const;
export const PARAGRAPH_FORMAT = ['align', 'level'] as const;

export interface Location {
  paragraph: number;
  run: number;
}

const paragraphsOf = (node: NfNode) =>
  (node.paragraphs as NfNode[] | undefined) ?? [];
const runsOf = leafRuns;

/** The formatting a new text box's text starts with */
export const TEXT_BOX_RUN_FORMAT = { size: 18 };

/** Where the editor takes each piece's formatting from: new text continues the text beside it, like typing */
export function textSources(
  before: NfNode,
  after: NfNode,
  origin: (id: string) => string = (id) => id
): {
  paragraphs: Array<number | undefined>;
  runs: Array<Array<Location | undefined>>;
} {
  const beforeParagraphs = paragraphsOf(before);
  const paragraphAt = new Map(beforeParagraphs.map((p, i) => [p.id, i]));
  const runAt = new Map<string, Location>();
  beforeParagraphs.forEach((paragraph, p) =>
    runsOf(paragraph).forEach((run, r) => {
      if (run.kind !== 'break') runAt.set(run.id, { paragraph: p, run: r });
    })
  );

  const afterParagraphs = paragraphsOf(after);
  const ownParagraph = afterParagraphs.map((p) =>
    paragraphAt.get(origin(p.id))
  );
  const paragraphs = ownParagraph.map((own, i) => {
    if (own !== undefined) return own;
    for (let j = i - 1; j >= 0; j--)
      if (ownParagraph[j] !== undefined) return ownParagraph[j];
    for (let j = i + 1; j < ownParagraph.length; j++)
      if (ownParagraph[j] !== undefined) return ownParagraph[j];
    return beforeParagraphs.length
      ? Math.min(i, beforeParagraphs.length - 1)
      : undefined;
  });

  const flat = afterParagraphs.flatMap((paragraph, p) =>
    runsOf(paragraph).map((run, r) => ({
      p,
      r,
      own: run.kind === 'break' ? undefined : runAt.get(origin(run.id)),
      isField: run.kind === 'field'
    }))
  );
  const plainRunIn = (source: number | undefined): Location | undefined => {
    if (source === undefined) return undefined;
    const r = runsOf(beforeParagraphs[source]).findIndex(
      (run) => run.kind === 'run'
    );
    return r >= 0 ? { paragraph: source, run: r } : undefined;
  };
  const runs = afterParagraphs.map((paragraph) =>
    runsOf(paragraph).map(() => undefined as Location | undefined)
  );
  flat.forEach(({ p, r, own }, k) => {
    if (own) {
      runs[p][r] = own;
      return;
    }
    // New text never continues a field, it would become a field too
    const sourceAt = (j: number) => (flat[j].isField ? undefined : flat[j].own);
    const nearest = (isCandidate: (j: number) => boolean) => {
      for (let j = k - 1; j >= 0; j--)
        if (isCandidate(j) && sourceAt(j)) return sourceAt(j);
      for (let j = k + 1; j < flat.length; j++)
        if (isCandidate(j) && sourceAt(j)) return sourceAt(j);
      return undefined;
    };
    // Rewritten text keeps its own paragraph's look before borrowing a neighbour's
    runs[p][r] =
      nearest((j) => flat[j].p === p) ??
      plainRunIn(ownParagraph[p]) ??
      nearest(() => true) ??
      plainRunIn(paragraphs[p]) ??
      beforeParagraphs.map((_, i) => plainRunIn(i)).find(Boolean);
  });
  return { paragraphs, runs };
}

export const runAt = (shape: NfNode, at: Location) =>
  runsOf(paragraphsOf(shape)[at.paragraph])[at.run];
export const paragraphAt = (shape: NfNode, at: number) =>
  paragraphsOf(shape)[at];
