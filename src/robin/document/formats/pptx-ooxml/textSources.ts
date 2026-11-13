import type { NfNode } from '../../tree';

export const RUN_FORMAT = [
  'bold',
  'italic',
  'underline',
  'strike',
  'size',
  'color',
  'font'
] as const;
export const PARAGRAPH_FORMAT = ['align', 'level'] as const;

/** What a run with no run to copy is given: the editor writes these explicitly */
export const UNSOURCED_RUN_FORMAT = {
  bold: false,
  italic: false,
  strike: false
};

export interface Location {
  paragraph: number;
  run: number;
}

const paragraphsOf = (node: NfNode) =>
  (node.paragraphs as NfNode[] | undefined) ?? [];
const runsOf = (paragraph: NfNode) => paragraph.runs as NfNode[];

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
  const fallback = (p: number): Location | undefined => {
    const source = paragraphs[p];
    const sourceRuns =
      source === undefined ? [] : runsOf(beforeParagraphs[source]);
    const r = sourceRuns.findIndex((run) => run.kind === 'run');
    if (source !== undefined && r >= 0) return { paragraph: source, run: r };
    return runAt.values().next().value;
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
    let found: Location | undefined;
    for (let j = k - 1; j >= 0 && !found; j--) found = sourceAt(j);
    for (let j = k + 1; j < flat.length && !found; j++) found = sourceAt(j);
    runs[p][r] = found ?? fallback(p);
  });
  return { paragraphs, runs };
}

export const runAt = (shape: NfNode, at: Location) =>
  runsOf(paragraphsOf(shape)[at.paragraph])[at.run];
export const paragraphAt = (shape: NfNode, at: number) =>
  paragraphsOf(shape)[at];
