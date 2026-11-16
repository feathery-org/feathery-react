import type { Residue } from '../../../pack';
import { clone, type NfNode, type NormalForm } from '../../../tree';
import {
  buildXml,
  child,
  childrenOf,
  descendant,
  tagOf,
  text,
  type ONode,
  type OTree
} from '../../../../../elements/components/PptxEditor/core/opc/xml';
import {
  writeNative,
  type InheritedFormat,
  type PendingSuggestion
} from '../native';
import { isSlot, runText } from './nodes';
import { DECK_ID, spTreeOf, type Pending } from './toNormalForm';

const isLive = (node: NfNode) =>
  !(node.pending as Pending | undefined)?.deletion;

function residueOf(residue: Residue, node: NfNode): ONode {
  const entry = residue[node.id];
  if (!entry)
    throw new Error(`Node ${node.id} has no native data to rebuild it from`);
  return clone(entry) as ONode;
}

function fill(holder: ONode | undefined, kids: ONode[]): void {
  if (!holder) return;
  const tag = tagOf(holder) as string;
  const out: OTree = [];
  let next = 0;
  let lastSlot = -1;
  for (const node of childrenOf(holder)) {
    if (!isSlot(node)) {
      out.push(node);
      continue;
    }
    if (next < kids.length) {
      out.push(kids[next++]);
      lastSlot = out.length - 1;
    }
  }
  out.splice(lastSlot + 1, 0, ...kids.slice(next));
  holder[tag] = out;
}

function writeRun(run: NfNode, residue: Residue): ONode {
  const node = residueOf(residue, run);
  const value = String(run.text);
  if (tagOf(node) === 'a:br' || runText(node) === value) return node;
  const t = child(node, 'a:t');
  if (t) t['a:t'] = value ? [text(value)] : [];
  return node;
}

function writeParagraphs(paragraphs: NfNode[], residue: Residue): ONode[] {
  return paragraphs.map((paragraph) => {
    const node = residueOf(residue, paragraph);
    fill(
      node,
      (paragraph.runs as NfNode[]).map((run) => writeRun(run, residue))
    );
    return node;
  });
}

function writeShape(shape: NfNode, residue: Residue): ONode {
  const node = residueOf(residue, shape);
  if (Array.isArray(shape.paragraphs))
    fill(
      child(node, 'p:txBody'),
      writeParagraphs(shape.paragraphs as NfNode[], residue)
    );
  if (Array.isArray(shape.rows))
    fill(
      descendant(node, 'a:tbl'),
      (shape.rows as NfNode[]).map((row) => {
        const rowNode = residueOf(residue, row);
        fill(
          rowNode,
          (row.cells as NfNode[]).map((cell) => {
            const cellNode = residueOf(residue, cell);
            fill(
              child(cellNode, 'a:txBody'),
              writeParagraphs(cell.paragraphs as NfNode[], residue)
            );
            return cellNode;
          })
        );
        return rowNode;
      })
    );
  if (Array.isArray(shape.shapes))
    fill(
      node,
      (shape.shapes as NfNode[])
        .filter(isLive)
        .map((member) => writeShape(member, residue))
    );
  return node;
}

export function fromNormalForm(nf: NormalForm, residue: Residue): string {
  const slides = (nf.root.slides as NfNode[]).filter(isLive).map((slide) => {
    const { slide: tree, inherited } = residue[slide.id] as {
      slide: OTree;
      inherited?: InheritedFormat;
    };
    const copy = clone(tree);
    fill(
      spTreeOf(copy),
      (slide.shapes as NfNode[])
        .filter(isLive)
        .map((shape) => writeShape(shape, residue))
    );
    return {
      path: String(slide.path),
      xml: buildXml(copy),
      ...(inherited ? { inherited } : {})
    };
  });
  const { pending } = residue[DECK_ID] as { pending: PendingSuggestion[] };
  return writeNative({ slides, pending });
}
