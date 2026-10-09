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
/** What a card says, carried in its group tag so it survives a save and reload. */
export interface CardText {
  title?: string;
  intent?: string;
}

export function groupTag(changeSetId: string, card: CardText = {}): string {
  return JSON.stringify({
    v: 1,
    source: 'robin',
    changeSetId,
    group: 'robin',
    ...(card.title ? { title: card.title } : {}),
    ...(card.intent ? { intent: card.intent } : {})
  });
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

  private readonly existingById = new Map<string, string>();

  private readonly cards: Readonly<Record<string, CardText>>;

  constructor(
    existing: NativeRevision[],
    date: string,
    cards: Readonly<Record<string, CardText>> = {}
  ) {
    this.existing = existing;
    this.date = date;
    this.cards = cards;
    // the document's own revisions are indexed first, so a change joined on a new anchor (Robin
    // deleting text the user inserted) keeps the user's revision instead of splitting it
    for (const rev of existing) {
      const id = String(rev.revisionId ?? '');
      if (!id) continue;
      const key = RevisionMinter.keyOf({
        kind: String(rev.revisionType),
        author: (rev.author as string | null) ?? null,
        group: groupOf(rev.customData)
      });
      this.existingById.set(id, key);
      if (!this.byKey.has(key)) this.byKey.set(key, id);
    }
  }

  private static keyOf(r: PendingRevision): string {
    return JSON.stringify([r.kind, r.author, r.group ?? null]);
  }

  /**
   * The revision id for one revision of a re-authored anchor: the anchor's own earlier id with the
   * same identity first (`prior`), then any revision of the document with that identity, then a new
   * one, minted once per identity.
   */
  idFor(r: PendingRevision, prior: readonly unknown[] = []): string {
    const key = RevisionMinter.keyOf(r);
    for (const id of prior)
      if (this.existingById.get(String(id)) === key) return String(id);
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
      ...(r.group ? { customData: groupTag(r.group, this.cards[r.group]) } : {})
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
