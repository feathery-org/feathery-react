import type { NfNode } from '../../tree';
import type { Pending } from './adapter/toNormalForm';

const quoted = (value: string, limit = 60) =>
  JSON.stringify(value.length > limit ? `${value.slice(0, limit)}…` : value);

function textOf(node: NfNode): string {
  if (Array.isArray(node.runs))
    return (node.runs as NfNode[]).map((run) => String(run.text)).join('');
  if (Array.isArray(node.paragraphs))
    return (node.paragraphs as NfNode[]).map(textOf).join(' / ');
  return '';
}

function pendingNote(node: NfNode): string {
  const pending = node.pending as Pending | undefined;
  if (!pending) return '';
  const notes = [
    pending.insertion && 'suggested',
    pending.deletion && 'suggested removal'
  ].filter(Boolean);
  return `[${notes.join(', ')}]`;
}

function slideTitle(slide: NfNode): string {
  const title = (slide.shapes as NfNode[]).find(
    (shape) => shape.placeholder === 'title' || shape.placeholder === 'ctrTitle'
  );
  return title ? textOf(title) : '';
}

export function detail(node: NfNode): string {
  const parts: string[] = [];
  if (node.kind === 'slide') {
    const title = slideTitle(node);
    if (title) parts.push(quoted(title));
    parts.push(`${(node.shapes as NfNode[]).length} shapes`);
  } else if (Array.isArray(node.runs)) {
    parts.push(quoted(textOf(node)));
  } else if (node.kind !== 'deck' && node.kind !== 'row') {
    if (node.name) parts.push(quoted(String(node.name), 40));
    if (node.placeholder) parts.push(`placeholder ${node.placeholder}`);
    const text = textOf(node);
    if (text) parts.push(quoted(text));
    if (Array.isArray(node.rows))
      parts.push(`${(node.rows as NfNode[]).length} rows`);
  }
  const pending = pendingNote(node);
  if (pending) parts.push(pending);
  return parts.join(' ');
}

// A deck's outline is one line per slide unless a depth or a slide is asked for
export const belowBlocks = (node: NfNode) =>
  node.kind !== 'slide' && node.kind !== 'deck';

// A paragraph's text is what find searches and spans index, as in a written document
export const ownText = (node: NfNode) =>
  node.kind === 'paragraph' ? textOf(node) : null;
