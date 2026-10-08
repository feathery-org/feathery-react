/**
 * Tracked changes in the normal form (architecture 4.2): the native encoding is a document-level
 * `revisions` table plus `revisionIds` at four anchors (an inline, a run's or a mark's character
 * format, a row's format). The normal form shows them as `pending` on the node:
 *
 *   { kind, author, group? }          one revision; `group` is the change set (the bridge turn id)
 *                                     when the revision carries the editor's group tag
 *   { ..., revisions: [ ... ] }       when the anchor holds more than one, all of them in order
 *   { mark: { ... } }                 the paragraph mark's own, beside the paragraph's
 *
 * The model reads `pending` and never writes it. The engine writes it when it composes a tracked
 * change set for a document replacement; `fromNormalForm` then mints the revisions.
 */
type Obj = Record<string, unknown>;

export interface NativeRevision {
  revisionId?: string;
  revisionType?: string;
  author?: string;
  date?: string;
  customData?: unknown;
}

export interface PendingRevision {
  kind: string;
  author: string | null;
  group?: string;
}

/** The change set a revision belongs to, from the editor's group tag, or undefined. */
export function groupOf(customData: unknown): string | undefined {
  if (typeof customData !== 'string' || !customData.trim()) return undefined;
  try {
    const parsed = JSON.parse(customData);
    return parsed &&
      parsed.source === 'robin' &&
      typeof parsed.changeSetId === 'string'
      ? parsed.changeSetId
      : undefined;
  } catch {
    return undefined;
  }
}

/** The editor's group tag for a change set (the product's revision group tag, version 1). */
export function groupTag(changeSetId: string, label = 'robin'): string {
  return JSON.stringify({ v: 1, source: 'robin', changeSetId, group: label });
}

export function viewOf(r: NativeRevision | undefined): PendingRevision {
  const group = groupOf(r?.customData);
  return {
    kind: r?.revisionType ?? 'Unknown',
    author: r?.author ?? null,
    ...(group ? { group } : {})
  };
}

/** The `pending` view of one anchor's revision ids, or null when it has none. */
export function pendingOf(
  ids: unknown,
  table: Map<string, NativeRevision>
): Obj | null {
  if (!Array.isArray(ids) || !ids.length) return null;
  const list = ids.map((id) => viewOf(table.get(String(id))));
  return list.length > 1 ? { ...list[0], revisions: list } : { ...list[0] };
}

/** Every revision a pending view names, in order (node-level part only). */
export function revisionsIn(pending: unknown): PendingRevision[] {
  if (!pending || typeof pending !== 'object') return [];
  const p = pending as Obj;
  if (Array.isArray(p.revisions)) return p.revisions as PendingRevision[];
  return typeof p.kind === 'string'
    ? [
        {
          kind: p.kind,
          author: (p.author as string | null) ?? null,
          ...(typeof p.group === 'string' ? { group: p.group } : {})
        }
      ]
    : [];
}

/**
 * Mints revisions for pending views the engine authored: one revision per change set, kind and
 * author, so a whole inserted subtree shares one Insertion id as the editor itself writes it.
 */
export class RevisionMinter {
  readonly minted: NativeRevision[] = [];

  private readonly byKey = new Map<string, string>();

  private readonly existing: NativeRevision[];

  private readonly date: string;

  constructor(existing: NativeRevision[], date: string) {
    this.existing = existing;
    this.date = date;
  }

  idFor(r: PendingRevision): string {
    // an existing revision with the same identity is reused (an anchor kept as it was)
    const key = JSON.stringify([r.kind, r.author, r.group ?? null]);
    const known = this.byKey.get(key);
    if (known) return known;
    const id = `rb${this.existing.length + this.minted.length}${Math.abs(
      hashOf(key)
    ).toString(36)}`;
    this.minted.push({
      author: r.author ?? 'Robin',
      date: this.date,
      revisionType: r.kind,
      revisionId: id,
      ...(r.group ? { customData: groupTag(r.group) } : {})
    });
    this.byKey.set(key, id);
    return id;
  }
}

function hashOf(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i += 1)
    h = Math.imul(h ^ s.charCodeAt(i), 2654435761);
  return h | 0;
}
