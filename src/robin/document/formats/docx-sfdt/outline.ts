/**
 * What the outline shows after each node's id and kind (contract section 3), and what `find`
 * searches: the lab's measured outline (WP3 F4), ported. A paragraph shows its named style, a
 * clipped text, page breaks, bookmarks, fields, images and the bindings in it; a table its size;
 * a row its cells' text, its row key and its bindings; a control its binding; every node its
 * pending change. Feature marks name the cards that teach them.
 */
import type { DocumentView, FeatureMark } from '../../pack';
import type { NfNode } from '../../tree';
import { HEADER_FOOTER, KIND } from './adapter/keys';
import { bindingMarks } from './features/formula';
import { sectionMarkerMark } from './features/sectionMarker';
import { arr } from './util';

type Obj = Record<string, unknown>;
const isObject = (v: unknown): v is Obj =>
  v !== null && typeof v === 'object' && !Array.isArray(v);

const clip = (s: string, n = 90) => {
  const t = s.replace(/\f/g, '').replace(/\s+/g, ' ').trim();
  return t.length > n ? `${t.slice(0, n)}... (${t.length} chars)` : t;
};

/** A paragraph's own text: its runs, including those inside inline controls. */
export function ownText(node: NfNode): string | null {
  if (node.kind !== KIND.paragraph) return null;
  let out = '';
  const rec = (inlines: unknown) => {
    for (const i of arr<NfNode>(inlines)) {
      if (i.kind === KIND.run && typeof i.text === 'string') out += i.text;
      if (Array.isArray(i.inlines)) rec(i.inlines);
    }
  };
  rec(node.inlines);
  return out;
}

const cellText = (cell: NfNode): string =>
  arr<NfNode>(cell.blocks)
    .map((b) => (b.kind === KIND.table ? '[table]' : ownText(b) ?? ''))
    .join(' ');

const pendingTag = (n: NfNode): string => {
  if (!isObject(n.pending)) return '';
  const p = n.pending;
  const parts = [p.kind, p.author && `by ${p.author}`].filter(Boolean);
  return ` [pending ${parts.join(' ')}${
    isObject(p.mark) ? `${parts.length ? ', ' : ''}mark ${p.mark.kind}` : ''
  }]`;
};

function bindingsIn(node: NfNode, view: DocumentView): string[] {
  const out: string[] = [];
  const rec = (n: unknown) => {
    if (Array.isArray(n)) return n.forEach(rec);
    if (!isObject(n)) return;
    if (n.kind === KIND.table && n !== node) return;
    if (
      n.kind === KIND.control &&
      isObject(n.binding) &&
      n.binding.name !== undefined
    ) {
      const b = n.binding;
      const used = view.annotation(String(n.id))?.usedBy;
      out.push(
        `${n.id}:${b.name}${b.expr ? `=${b.expr}` : ''}${
          b.global ? ' global' : ''
        }${used?.length ? ` usedBy[${used.join(',')}]` : ''}`
      );
    }
    for (const [k, v] of Object.entries(n))
      if (k !== 'binding' && k !== 'pending') rec(v);
  };
  rec(node.kind === KIND.row ? node.cells : node.inlines ?? node.blocks);
  return out;
}

function inlineFlags(p: NfNode): string[] {
  const flags: string[] = [];
  const marks: string[] = [];
  let fields = 0;
  let images = 0;
  for (const i of arr<NfNode>(p.inlines)) {
    if (i.kind === KIND.bookmark && !String(i.name ?? '').startsWith('_'))
      marks.push(`${i.bookmarkType === 0 ? 'start' : 'end'} ${i.name}`);
    if (i.kind === KIND.field && i.fieldType === 0) fields += 1;
    if (i.kind === KIND.image) images += 1;
  }
  if ((ownText(p) ?? '').includes('\f')) flags.push('page break');
  if (marks.length) flags.push(`bookmark ${marks.join(', ')}`);
  if (fields) flags.push(`${fields} field(s)`);
  if (images) flags.push(`${images} image(s)`);
  return flags;
}

/** Everything after the id and kind tokens of a node's outline line. */
export function detail(node: NfNode, view: DocumentView): string {
  const formats = view.nf.formats;
  const styleName = (ref: unknown) =>
    typeof ref === 'string' && typeof formats[ref]?.styleName === 'string'
      ? (formats[ref].styleName as string)
      : null;
  const used = view.annotation(node.id)?.usedBy;
  const usedBy = used?.length ? ` usedBy[${used.join(',')}]` : '';
  switch (node.kind) {
    case KIND.section: {
      const index = arr<NfNode>(view.nf.root.sections).findIndex(
        (s) => s.id === node.id
      );
      const brk =
        typeof node.style === 'string'
          ? formats[node.style]?.breakCode
          : undefined;
      return `${index + 1}${brk ? ` (break: ${brk})` : ''}${pendingTag(node)}`;
    }
    case KIND.paragraph: {
      const sn = styleName(node.style);
      const flags = inlineFlags(node);
      const marks = sectionMarkerMark(node, ownText(node)).map(
        (m) => `section-marker ${m.value}`
      );
      const bs = bindingsIn(node, view);
      return `${sn ? `[${sn}] ` : ''}"${clip(ownText(node) ?? '')}"${
        flags.length || marks.length
          ? ` (${[...flags, ...marks].join('; ')})`
          : ''
      }${pendingTag(node)}${bs.length ? `  {${bs.join('; ')}}` : ''}`;
    }
    case KIND.table: {
      const rows = arr<NfNode>(node.rows);
      const cols = Math.max(
        0,
        ...rows.map((r) => arr<unknown>(r.cells).length)
      );
      return `${rows.length} rows x ${cols} cells${pendingTag(node)}`;
    }
    case KIND.row: {
      const cells = arr<NfNode>(node.cells).map((c) => clip(cellText(c), 40));
      const bs = bindingsIn(node, view);
      let key: string | null = null;
      const rec = (n: unknown) => {
        if (key || !isObject(n)) {
          if (Array.isArray(n)) n.forEach(rec);
          return;
        }
        if (isObject(n.binding) && typeof n.binding.row === 'string')
          key = n.binding.row;
        for (const v of Object.values(n)) rec(v);
      };
      rec(node.cells);
      const header =
        typeof node.style === 'string' && formats[node.style]?.isHeader === true
          ? ' (header)'
          : '';
      return `${cells.join(' | ')}${header}${pendingTag(node)}${
        bs.length ? `  {${key ? `row=${key}; ` : ''}${bs.join('; ')}}` : ''
      }`;
    }
    case KIND.cell:
      return `"${clip(cellText(node), 40)}"${pendingTag(node)}`;
    case KIND.control: {
      const b = isObject(node.binding) ? node.binding : null;
      const what = b
        ? b.table !== undefined
          ? `(bound table "${b.table}")`
          : `(binding ${b.name}${b.expr ? `=${b.expr}` : ''})`
        : '';
      return `${
        Array.isArray(node.blocks) ? 'block ' : ''
      }${what}${usedBy}${pendingTag(node)}`.trim();
    }
    case KIND.run:
      return `"${clip(String(node.text ?? ''), 60)}"${pendingTag(node)}`;
    case KIND.bookmark:
      return `${node.bookmarkType === 0 ? 'start' : 'end'} ${node.name}`;
    case KIND.field:
      return `${
        node.fieldType === 0
          ? 'begin'
          : node.fieldType === 2
          ? 'separator'
          : 'end'
      }${pendingTag(node)}`;
    case KIND.image:
      return `${node.width ?? '?'} x ${node.height ?? '?'}${pendingTag(node)}`;
    case KIND.shape:
      return 'text box';
    default:
      return pendingTag(node).trim();
  }
}

/** A story label before a section's child lists: body, header, footer, firstPageHeader and so on. */
export function listLabel(node: NfNode, key: string): string | null {
  if (node.kind !== KIND.section) return null;
  if (key === 'blocks') return 'body';
  return key.startsWith(`${HEADER_FOOTER}/`) ? key.split('/')[1] : null;
}

export function features(node: NfNode): FeatureMark[] {
  return [...bindingMarks(node), ...sectionMarkerMark(node, ownText(node))];
}
