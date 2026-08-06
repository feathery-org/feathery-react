/**
 * Single owner of DocumentData. Every mutation is a pure function
 * (DocumentData) => DocumentData applied through `apply`, which tracks
 * undo/redo history at the data level.
 */
import { Block, BlockType, Cell, DocumentData, Inline, Theme } from './types';

export type UpdateOrigin = 'panel' | 'document' | 'history' | 'theme';

/** Past history is capped, not unbounded — a long editing session must not
 *  grow this array forever. Oldest entries drop first; undo simply runs out. */
const MAX_HISTORY = 100;

export type BlockStore = {
  getData: () => DocumentData;
  /** Every mutation goes through apply; one call = one undo step. */
  apply: (
    mutate: (data: DocumentData) => DocumentData,
    origin: UpdateOrigin
  ) => void;
  undo: () => void;
  redo: () => void;
  canUndo: () => boolean;
  canRedo: () => boolean;
  subscribe: (
    fn: (data: DocumentData, origin: UpdateOrigin) => void
  ) => () => void;
};

export const createBlockStore = (initial: DocumentData): BlockStore => {
  let data = initial;
  const past: DocumentData[] = [];
  const future: DocumentData[] = [];
  const listeners = new Set<(d: DocumentData, o: UpdateOrigin) => void>();
  const notify = (origin: UpdateOrigin) =>
    listeners.forEach((fn) => fn(data, origin));

  return {
    getData: () => data,
    apply: (mutate, origin) => {
      const next = mutate(data);
      if (next === data) return; // no-op mutations do not pollute history
      past.push(data);
      if (past.length > MAX_HISTORY) past.shift();
      future.length = 0;
      data = next;
      notify(origin);
    },
    undo: () => {
      const prev = past.pop();
      if (!prev) return;
      future.push(data);
      data = prev;
      notify('history');
    },
    redo: () => {
      const next = future.pop();
      if (!next) return;
      past.push(data);
      data = next;
      notify('history');
    },
    canUndo: () => past.length > 0,
    canRedo: () => future.length > 0,
    subscribe: (fn) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    }
  };
};

const defaultRows = (): Cell[][] => [
  [1, 2, 3].map((n) => ({
    content: [{ kind: 'text', text: `Column ${n}` } as Inline]
  })),
  [1, 2, 3].map(() => ({
    content: [{ kind: 'text', text: 'Cell' } as Inline]
  })),
  [1, 2, 3].map(() => ({ content: [{ kind: 'text', text: 'Cell' } as Inline] }))
];

const defaultContent = (type: BlockType): Inline[] =>
  type === 'h1' || type === 'h2' || type === 'h3'
    ? [{ kind: 'text', text: 'New heading' }]
    : [{ kind: 'text', text: 'New paragraph' }];

const buildBlock = (type: BlockType, id: string): Block =>
  type === 'table'
    ? { id, type, rows: defaultRows() }
    : { id, type, content: defaultContent(type) };

export const insertBlock =
  (
    sectionId: string,
    afterBlockId: string | null,
    type: BlockType,
    id: string
  ) =>
  (data: DocumentData): DocumentData => {
    const sectionIndex = data.sections.findIndex((s) => s.id === sectionId);
    if (sectionIndex === -1) return data;

    const section = data.sections[sectionIndex];
    const newBlock = buildBlock(type, id);
    const insertAt =
      afterBlockId === null
        ? 0
        : section.blocks.findIndex((b) => b.id === afterBlockId) + 1;

    const blocks = [
      ...section.blocks.slice(0, insertAt),
      newBlock,
      ...section.blocks.slice(insertAt)
    ];

    return {
      ...data,
      sections: data.sections.map((s, i) =>
        i === sectionIndex ? { ...s, blocks } : s
      )
    };
  };

export const deleteBlock =
  (blockId: string) =>
  (data: DocumentData): DocumentData => {
    const sectionIndex = data.sections.findIndex((s) =>
      s.blocks.some((b) => b.id === blockId)
    );
    if (sectionIndex === -1) return data;

    const section = data.sections[sectionIndex];
    const blocks = section.blocks.filter((b) => b.id !== blockId);

    return {
      ...data,
      sections: data.sections.map((s, i) =>
        i === sectionIndex ? { ...s, blocks } : s
      )
    };
  };

export const updateBlockContent =
  (blockId: string, content: Inline[]) =>
  (data: DocumentData): DocumentData => {
    const sectionIndex = data.sections.findIndex((s) =>
      s.blocks.some((b) => b.id === blockId)
    );
    if (sectionIndex === -1) return data;

    const section = data.sections[sectionIndex];
    const blocks = section.blocks.map((b) =>
      b.id === blockId ? { ...b, content } : b
    );

    return {
      ...data,
      sections: data.sections.map((s, i) =>
        i === sectionIndex ? { ...s, blocks } : s
      )
    };
  };

export const updateCell =
  (blockId: string, row: number, col: number, content: Inline[]) =>
  (data: DocumentData): DocumentData => {
    const sectionIndex = data.sections.findIndex((s) =>
      s.blocks.some((b) => b.id === blockId)
    );
    if (sectionIndex === -1) return data;

    const block = data.sections[sectionIndex].blocks.find(
      (b) => b.id === blockId
    )!;
    if (!block.rows?.[row]?.[col]) return data; // not a table, or row/col out of range

    const section = data.sections[sectionIndex];
    const blocks = section.blocks.map((b) => {
      if (b.id !== blockId) return b;
      const rows = b.rows!.map((r, ri) =>
        ri === row ? r.map((c, ci) => (ci === col ? { ...c, content } : c)) : r
      );
      return { ...b, rows };
    });

    return {
      ...data,
      sections: data.sections.map((s, i) =>
        i === sectionIndex ? { ...s, blocks } : s
      )
    };
  };

export const setTheme =
  (theme: Theme) =>
  (data: DocumentData): DocumentData => ({
    ...data,
    theme
  });
