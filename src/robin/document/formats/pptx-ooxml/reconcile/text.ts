import type {
  RichPara,
  TextStyle
} from '../../../../../elements/components/PptxEditor/core/model/edit';
import { canonicalJson, type NfNode } from '../../../tree';
import {
  RUN_FORMAT,
  paragraphAt,
  runAt,
  textSources,
  type Location
} from '../textSources';
import type { TableCellAddress } from '../../../../../elements/components/PptxEditor/engine/commands';
import type { DeckOperation, ShapeRef, SlideRef } from '../seams/deck';
import { leafRuns } from '../tree';

const paragraphsOf = (node: NfNode) => node.paragraphs as NfNode[];

function breakLocation(
  before: NfNode,
  id: string
): { paragraph: number; run: number } | undefined {
  for (const [p, paragraph] of paragraphsOf(before).entries()) {
    const r = leafRuns(paragraph).findIndex((run) => run.id === id);
    if (r >= 0) return { paragraph: p, run: r };
  }
  return undefined;
}

function styleChange(
  from: Record<string, unknown>,
  to: NfNode
): TextStyle | null {
  const style: TextStyle = {};
  for (const key of RUN_FORMAT) {
    const value = to[key];
    if (value === undefined || value === from[key]) continue;
    if (key === 'size') style.sizePt = value as number;
    else if (key === 'color')
      style.color = String(value).replace('#', '').toUpperCase();
    else if (key === 'highlight')
      style.highlight =
        value === 'none' ? null : String(value).replace('#', '').toUpperCase();
    else if (key === 'font') style.font = value as string;
    else style[key] = value as boolean;
  }
  return Object.keys(style).length ? style : null;
}

/** Where each link of the shape starts, the run the editor copies the link from, and the link each run sits in */
function linkLayout(shape: NfNode): {
  starts: Map<string, Location>;
  linkOf: Map<string, string | null>;
} {
  const starts = new Map<string, Location>();
  const linkOf = new Map<string, string | null>();
  paragraphsOf(shape).forEach((paragraph, p) => {
    let r = 0;
    for (const run of paragraph.runs as NfNode[]) {
      const inner = run.kind === 'link' ? (run.runs as NfNode[]) : [run];
      if (run.kind === 'link') starts.set(run.id, { paragraph: p, run: r });
      for (const leaf of inner)
        linkOf.set(leaf.id, run.kind === 'link' ? run.id : null);
      r += inner.length;
    }
  });
  return { starts, linkOf };
}

/** New text as the editor's own edits, then the formatting of each run that differs from what it continues */
export function textOperations(
  slide: SlideRef,
  shape: ShapeRef,
  before: NfNode,
  after: NfNode,
  origin: (id: string) => string = (id) => id,
  cell?: TableCellAddress
): DeckOperation[] {
  if (
    canonicalJson(paragraphsOf(before)) === canonicalJson(paragraphsOf(after))
  )
    return [];
  const sources = textSources(before, after, origin);
  const { starts, linkOf } = linkLayout(before);
  // Each run with the link it sits in, none when it is outside every link
  const linked = (paragraph: NfNode) =>
    (paragraph.runs as NfNode[]).flatMap(
      (run): Array<{ run: NfNode; link: string | null }> =>
        run.kind === 'link'
          ? (run.runs as NfNode[]).map((inner) => ({
              run: inner,
              link: origin(run.id)
            }))
          : [{ run, link: null }]
    );
  // A run left in the link it was in keeps its own link tags, a new run those of the run it continues
  const linkWrite = (run: NfNode, link: string | null, at?: Location) => {
    const own = linkOf.has(origin(run.id))
      ? origin(run.id)
      : at && runAt(before, at)?.id;
    return own !== undefined && linkOf.get(own) === link
      ? {}
      : { link: link === null ? null : starts.get(link) ?? null };
  };
  const paragraphs: RichPara[] = paragraphsOf(after).map((paragraph, p) => {
    const source = sources.paragraphs[p];
    const from = source === undefined ? undefined : paragraphAt(before, source);
    const rich: RichPara = {
      ...(source === undefined ? {} : { sourceParagraph: source }),
      runs: linked(paragraph).map(({ run, link }, r) => {
        if (run.kind === 'break') {
          const own = breakLocation(before, origin(run.id));
          return {
            text: '',
            break: true,
            ...(own ? { source: own } : {}),
            ...linkWrite(run, link)
          };
        }
        const at = sources.runs[p][r];
        return {
          text: String(run.text),
          ...(at ? { source: at, styleChanged: false } : {}),
          ...linkWrite(run, link, at)
        };
      })
    };
    if (paragraph.align !== undefined && paragraph.align !== from?.align)
      rich.align = paragraph.align as RichPara['align'];
    if (paragraph.level !== undefined && paragraph.level !== from?.level)
      rich.level = paragraph.level as number;
    return rich;
  });
  const operations: DeckOperation[] = [
    {
      command: {
        type: 'replace-rich-text',
        onSlide: slide,
        onShape: shape,
        ...(cell ? { cell } : {}),
        paragraphs
      }
    }
  ];

  paragraphsOf(after).forEach((paragraph, p) => {
    let offset = 0;
    leafRuns(paragraph).forEach((run, r) => {
      const start = offset;
      offset += String(run.text).length;
      if (run.kind !== 'run' || start === offset) return;
      const at = sources.runs[p][r];
      const style = styleChange(at ? runAt(before, at) : {}, run);
      if (style)
        operations.push({
          command: {
            type: 'format-text',
            onSlide: slide,
            onShape: shape,
            ...(cell ? { cell } : {}),
            style,
            ranges: [{ paragraph: p, start, end: offset }]
          }
        });
    });
  });
  return operations;
}
