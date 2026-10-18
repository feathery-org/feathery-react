/**
 * A Word table of contents: a TOC field whose result is one entry paragraph per heading, each a
 * HYPERLINK to the heading's bookmark and a PAGEREF giving its page. Everything in the field's
 * result is derived: the editor rebuilds it from the headings and its own layout after every change
 * (the `toc` seam), the proof does not compare it (N1), and a write into it is refused
 * (`derived-content`). A contents table someone typed (plain paragraphs or a table) is not a field
 * and none of this applies to it.
 *
 * Which paragraphs a field lists, as Word and the editor read its switches: `\o "a-b"` the
 * paragraphs styled Heading a to Heading b, `\t "Style,level,..."` the paragraphs in those styles.
 */
import type { Annotation, DocumentView } from '../../pack';
import type { NfNode, NormalForm } from '../../tree';
import { HEADER_FOOTER, KIND, TEXT_FRAME } from './adapter/keys';
import { revisionsIn } from './adapter/revisions';
import { arr } from './util';

export interface TocField {
  /** The field code, trimmed (`TOC \h \z \t "Title,1"`). */
  code: string;
  /** The node holding the block list the field's paragraphs sit in, and the list's key. */
  container: NfNode;
  listKey: string;
  /** The paragraphs from the one holding the field's begin to the one holding its end. */
  paragraphs: NfNode[];
  /**
   * Where the field begins in the first paragraph's inlines and ends in the last one's: what is
   * before the begin (a title) and after the end is the document's, not the field's.
   */
  beginAt: number;
  endAt: number;
  /**
   * Every node of the field's result: from its separator to its end mark, and the paragraphs
   * between the first and the last whole. The code before the separator is the document's: the
   * rebuild reads it (`\o "1-2"` lists two levels).
   */
  ids: Set<string>;
  /** The paragraph styles whose paragraphs it lists. */
  styles: Set<string>;
  /** Whether the field sits in a content control (the editor's rebuild breaks the control). */
  inControl: boolean;
  /** The entries it lists now, by their visible text. */
  entries: string[];
}

/** A block list a contents table lists headings from: the body, never a header, footer or text box. */
const bodyList = (key: string | null) =>
  !key || !(key.startsWith(HEADER_FOOTER) || key.startsWith(TEXT_FRAME));

/** A paragraph's inline nodes in reading order, through inline controls. */
function inlineOrder(paragraph: NfNode): NfNode[] {
  const out: NfNode[] = [];
  const rec = (inlines: unknown) => {
    for (const i of arr<NfNode>(inlines)) {
      out.push(i);
      if (Array.isArray(i.inlines)) rec(i.inlines);
    }
  };
  rec(paragraph.inlines);
  return out;
}

const deleted = (n: NfNode) =>
  revisionsIn(n.pending).some((r) => r.kind === 'Deletion');

/** Whitespace as an entry shows it: tabs and breaks as spaces, runs of spaces as one. */
export const entryText = (s: string): string =>
  s
    .replace(/[\t\f\v\r\n]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

/**
 * A paragraph's visible text: its runs less field codes and PAGEREF results (a contents entry's
 * page number is not its text).
 */
export function visibleText(paragraph: NfNode): string {
  const open: Array<{ code: string; result: boolean }> = [];
  let out = '';
  for (const i of inlineOrder(paragraph)) {
    const top = open[open.length - 1];
    if (i.kind === KIND.field && i.fieldType === 0)
      open.push({ code: '', result: false });
    else if (i.kind === KIND.field && i.fieldType === 2) {
      if (top) top.result = true;
    } else if (i.kind === KIND.field && i.fieldType === 1) open.pop();
    else if (i.kind === KIND.run && typeof i.text === 'string' && !deleted(i)) {
      if (top && !top.result) top.code += i.text;
      else if (!open.some((f) => fieldName(f.code) === 'PAGEREF'))
        out += i.text;
    }
  }
  return entryText(out);
}

const fieldName = (code: string) =>
  code.trim().split(/\s+/)[0]?.toUpperCase() ?? '';

/** The paragraph styles a TOC field code lists, from its `\o` and `\t` switches. */
export function tocStyles(code: string): Set<string> {
  const out = new Set<string>();
  const o = /\\o\s+"(\d+)-(\d+)"/.exec(code);
  if (o)
    for (let k = Number(o[1]); k <= Number(o[2]); k += 1)
      out.add(`Heading ${k}`);
  const t = /\\t\s+"([^"]*)"/.exec(code);
  if (t)
    t[1]
      .split(',')
      .filter((_, k) => k % 2 === 0)
      .map((s) => s.trim())
      .filter(Boolean)
      .forEach((s) => out.add(s));
  // a bare TOC lists the first three heading levels, as the editor builds it
  if (!o && !t) for (let k = 1; k <= 3; k += 1) out.add(`Heading ${k}`);
  return out;
}

const ofView = new WeakMap<DocumentView, TocField | null>();

/**
 * `tocField` of a view, read once per view: a view is one settled version of the document, while a
 * normal form can still be written (a finalizer's working copy).
 */
export function viewToc(view: DocumentView): TocField | null {
  if (!ofView.has(view)) ofView.set(view, tocField(view.nf));
  return ofView.get(view) as TocField | null;
}

/** The document's table of contents field in the body, or null when it has none. */
export function tocField(nf: NormalForm): TocField | null {
  // every body paragraph in reading order, with the list it sits in
  const paragraphs: Array<{
    node: NfNode;
    parent: NfNode;
    key: string;
    inControl: boolean;
  }> = [];
  const rec = (node: NfNode, inControl: boolean) => {
    for (const key of listKeys(node)) {
      if (!bodyList(key) || key === 'inlines') continue;
      for (const child of arr<NfNode>(listAt(node, key))) {
        if (child.kind === KIND.paragraph)
          paragraphs.push({ node: child, parent: node, key, inControl });
        rec(child, inControl || child.kind === KIND.control);
      }
    }
  };
  rec(nf.root, false);
  // fields as a stack across paragraphs: the TOC field's begin and end paragraphs
  const open: Array<{
    code: string;
    result: boolean;
    at: number;
    mark: NfNode;
  }> = [];
  let begin = -1;
  let code = '';
  for (let k = 0; k < paragraphs.length; k += 1) {
    for (const i of inlineOrder(paragraphs[k].node)) {
      const top = open[open.length - 1];
      if (i.kind === KIND.field && i.fieldType === 0)
        open.push({ code: '', result: false, at: k, mark: i });
      else if (i.kind === KIND.field && i.fieldType === 2) {
        if (top) top.result = true;
      } else if (i.kind === KIND.field && i.fieldType === 1) {
        const closed = open.pop();
        if (closed && fieldName(closed.code) === 'TOC' && begin < 0) {
          begin = closed.at;
          code = closed.code.trim();
          return range(paragraphs.slice(begin, k + 1), code, closed.mark, i);
        }
      } else if (i.kind === KIND.run && top && !top.result && !deleted(i))
        top.code += String(i.text ?? '');
    }
  }
  return null;
}

function range(
  span: Array<{
    node: NfNode;
    parent: NfNode;
    key: string;
    inControl: boolean;
  }>,
  code: string,
  beginMark: NfNode,
  endMark: NfNode
): TocField | null {
  const [first] = span;
  const last = span[span.length - 1];
  // the field's paragraphs are one run of siblings in one list, and its marks are among their own
  // inlines (not inside an inline control); anything else is not handled
  const list = arr<NfNode>(listAt(first.parent, first.key));
  const at = list.indexOf(first.node);
  const beginAt = arr<NfNode>(first.node.inlines).indexOf(beginMark);
  const endAt = arr<NfNode>(last.node.inlines).indexOf(endMark);
  if (
    beginAt < 0 ||
    endAt < 0 ||
    span.some(
      (p, k) =>
        p.parent !== first.parent ||
        p.key !== first.key ||
        list[at + k] !== p.node
    )
  )
    return null;
  // each paragraph's part of the field: the first from the begin, the last to the end
  const parts = span.map((p, k) => {
    const inlines = arr<NfNode>(p.node.inlines);
    const from = k === 0 ? beginAt : 0;
    const to = k === span.length - 1 ? endAt + 1 : inlines.length;
    return {
      node: p.node,
      inlines: inlines.slice(from, to),
      whole: k > 0 && k < span.length - 1
    };
  });
  const ids = new Set<string>();
  const collect = (n: unknown) => {
    if (Array.isArray(n)) return n.forEach(collect);
    if (!n || typeof n !== 'object') return;
    const o = n as NfNode;
    if (typeof o.id === 'string') ids.add(o.id);
    for (const [k, v] of Object.entries(o)) if (k !== 'pending') collect(v);
  };
  // the result starts at the field's own separator (the first at its depth after the begin); a code
  // that runs past its first paragraph leaves the whole field derived
  const head = arr<NfNode>(first.node.inlines);
  let separatorAt = beginAt;
  for (let k = beginAt, depth = 0; k < head.length; k += 1) {
    const i = head[k];
    if (i.kind !== KIND.field) continue;
    if (i.fieldType === 0) depth += 1;
    else if (i.fieldType === 1) depth -= 1;
    else if (i.fieldType === 2 && depth === 1) {
      separatorAt = k;
      break;
    }
  }
  parts.forEach((part, k) =>
    collect(
      part.whole
        ? part.node
        : k === 0
        ? part.inlines.slice(separatorAt - beginAt)
        : part.inlines
    )
  );
  return {
    code,
    container: first.parent,
    listKey: first.key,
    paragraphs: span.map((p) => p.node),
    beginAt,
    endAt,
    ids,
    styles: tocStyles(code),
    inControl: first.inControl,
    entries: parts
      .map((part) => visibleText({ ...part.node, inlines: part.inlines }))
      .filter(Boolean)
  };
}

/** The switches of a contents field code, each with its argument (`\o "1-3"`, `\h`). */
function switchesOf(code: string): Array<{ name: string; arg: string }> {
  const out: Array<{ name: string; arg: string }> = [];
  const re = /\\([a-zA-Z*])\s*(?:"([^"]*)"|([^\s\\]+))?/g;
  for (let m = re.exec(code); m; m = re.exec(code))
    out.push({ name: m[1].toLowerCase(), arg: m[2] ?? m[3] ?? '' });
  return out;
}

/**
 * The switches the editor's rebuild cannot reproduce, as they are written in the code. The editor
 * models `\o "a-b"`, `\t`, `\h`, `\z`, `\u`, `\n` with no range and `\p " "`, and drops a
 * `\* MERGEFORMAT`; anything else (a table of figures, `\c`; a bookmark range, `\b`; kept tabs,
 * `\w`...) would be rebuilt as a different contents.
 */
export function unsupportedSwitches(code: string): string[] {
  return switchesOf(code)
    .filter(({ name, arg }) => {
      switch (name) {
        case 'o':
          return !/^\d+-\d+$/.test(arg);
        case 't':
          return false;
        case 'h':
        case 'z':
        case 'u':
        case 'n':
          return arg !== '';
        case 'p':
          return arg !== ' ' && arg !== '';
        case '*':
          return arg.toUpperCase() !== 'MERGEFORMAT';
        default:
          return true;
      }
    })
    .map(({ name, arg }) => `\\${name}${arg ? ` ${arg}` : ''}`);
}

/** The paragraphs a contents table lists, in reading order, with their text: its headings. */
export function tocSources(
  nf: NormalForm,
  toc: TocField
): Array<{ node: NfNode; text: string }> {
  const out: Array<{ node: NfNode; text: string }> = [];
  const styleName = (ref: unknown) =>
    typeof ref === 'string' ? nf.formats[ref]?.styleName : undefined;
  const rec = (node: NfNode, inBody: boolean) => {
    for (const key of listKeys(node)) {
      if (!(inBody && bodyList(key)) || key === 'inlines') continue;
      for (const child of arr<NfNode>(listAt(node, key))) {
        if (
          child.kind === KIND.paragraph &&
          !toc.ids.has(child.id) &&
          toc.styles.has(String(styleName(child.style)))
        ) {
          const text = visibleText(child);
          if (text) out.push({ node: child, text });
        }
        rec(child, true);
      }
    }
  };
  rec(nf.root, true);
  return out;
}

function listKeys(node: NfNode): string[] {
  switch (node.kind) {
    case KIND.document:
      return ['sections'];
    case KIND.table:
      return ['rows'];
    case KIND.row:
      return ['cells'];
    case KIND.shape:
      return [`${TEXT_FRAME}/blocks`];
    case KIND.section: {
      const hf = node[HEADER_FOOTER];
      return [
        'blocks',
        ...(hf && typeof hf === 'object'
          ? Object.keys(hf as object).map((s) => `${HEADER_FOOTER}/${s}/blocks`)
          : [])
      ];
    }
    default:
      return ['blocks', 'inlines'];
  }
}

function listAt(node: NfNode, key: string): unknown {
  let cur: unknown = node;
  for (const part of key.split('/'))
    cur =
      cur && typeof cur === 'object'
        ? (cur as Record<string, unknown>)[part]
        : undefined;
  return cur;
}

/** `derived: { source: "toc" }` on every paragraph of the table of contents, added to `annotations`. */
export function tocAnnotations(
  view: DocumentView,
  annotations: Map<string, Annotation>
): Map<string, Annotation> {
  const toc = viewToc(view);
  for (const p of toc?.paragraphs ?? []) {
    const a = annotations.get(p.id) ?? {};
    annotations.set(p.id, { ...a, derived: { ...a.derived, source: 'toc' } });
  }
  return annotations;
}
