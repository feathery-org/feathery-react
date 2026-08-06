import {
  createBlockStore,
  insertBlock,
  deleteBlock,
  updateBlockContent,
  updateCell,
  setTheme
} from '../store';
import { SAMPLE_DOCUMENT } from '../sampleDocument';
import { EMPTY_THEME } from '../types';

describe('createBlockStore', () => {
  it('apply replaces data immutably; the previous object is untouched', () => {
    const store = createBlockStore(SAMPLE_DOCUMENT);
    const before = store.getData();
    store.apply(updateBlockContent('blk_title', [{ kind: 'text', text: 'New Title' }]), 'panel');
    expect(store.getData()).not.toBe(before);
    expect(before).toBe(SAMPLE_DOCUMENT);
    expect(before.sections[0].blocks[0].content).toEqual([
      { kind: 'text', text: 'Service Agreement' }
    ]);
  });

  it("undo restores the previous data and notifies with origin 'history'; redo reverses it. A fresh apply clears the redo stack", () => {
    const store = createBlockStore(SAMPLE_DOCUMENT);
    const initial = store.getData();
    store.apply(updateBlockContent('blk_title', [{ kind: 'text', text: 'Edit 1' }]), 'panel');
    const afterFirst = store.getData();

    const events: string[] = [];
    store.subscribe((_data, origin) => events.push(origin));

    store.undo();
    expect(store.getData()).toBe(initial);
    expect(events).toEqual(['history']);

    store.redo();
    expect(store.getData()).toBe(afterFirst);
    expect(events).toEqual(['history', 'history']);

    store.undo();
    expect(store.getData()).toBe(initial);
    expect(store.canRedo()).toBe(true);

    store.apply(updateBlockContent('blk_title', [{ kind: 'text', text: 'Edit 2' }]), 'panel');
    expect(store.canRedo()).toBe(false);
  });

  it("insertBlock('sec_x', null, 'table', 'blk_new') prepends to the section; a new table gets 3x3 rows — header Column 1..3, body cells Cell", () => {
    const mutate = insertBlock('sec_pricing', null, 'table', 'blk_new');
    const next = mutate(SAMPLE_DOCUMENT);
    const section = next.sections.find((s) => s.id === 'sec_pricing')!;
    expect(section.blocks[0].id).toBe('blk_new');
    expect(section.blocks[0].rows).toEqual([
      [
        { content: [{ kind: 'text', text: 'Column 1' }] },
        { content: [{ kind: 'text', text: 'Column 2' }] },
        { content: [{ kind: 'text', text: 'Column 3' }] }
      ],
      [
        { content: [{ kind: 'text', text: 'Cell' }] },
        { content: [{ kind: 'text', text: 'Cell' }] },
        { content: [{ kind: 'text', text: 'Cell' }] }
      ],
      [
        { content: [{ kind: 'text', text: 'Cell' }] },
        { content: [{ kind: 'text', text: 'Cell' }] },
        { content: [{ kind: 'text', text: 'Cell' }] }
      ]
    ]);
  });

  it('insertBlock after an id places it immediately after that block', () => {
    const mutate = insertBlock('sec_intro', 'blk_title', 'paragraph', 'blk_new');
    const next = mutate(SAMPLE_DOCUMENT);
    const section = next.sections.find((s) => s.id === 'sec_intro')!;
    const ids = section.blocks.map((b) => b.id);
    expect(ids).toEqual(['blk_title', 'blk_new', 'blk_intro', 'blk_scope_h', 'blk_scope_p']);
    expect(section.blocks[1].content).toEqual([{ kind: 'text', text: 'New paragraph' }]);
  });

  it('deleteBlock removes it from whichever section holds it', () => {
    const mutate = deleteBlock('blk_pricing_h');
    const next = mutate(SAMPLE_DOCUMENT);
    const section = next.sections.find((s) => s.id === 'sec_pricing')!;
    expect(section.blocks.map((b) => b.id)).toEqual(['blk_pricing_tbl']);
    // untouched section keeps its blocks
    const otherSection = next.sections.find((s) => s.id === 'sec_intro')!;
    expect(otherSection).toBe(SAMPLE_DOCUMENT.sections[0]);
  });

  it("updateCell replaces one cell's content, leaving every other cell identical (same reference)", () => {
    const mutate = updateCell('blk_pricing_tbl', 1, 1, [{ kind: 'text', text: '$500' }]);
    const next = mutate(SAMPLE_DOCUMENT);
    const table = next.sections
      .flatMap((s) => s.blocks)
      .find((b) => b.id === 'blk_pricing_tbl')!;
    const originalTable = SAMPLE_DOCUMENT.sections
      .flatMap((s) => s.blocks)
      .find((b) => b.id === 'blk_pricing_tbl')!;

    expect(table.rows![1][1].content).toEqual([{ kind: 'text', text: '$500' }]);
    expect(table.rows![0][0]).toBe(originalTable.rows![0][0]);
    expect(table.rows![0][1]).toBe(originalTable.rows![0][1]);
    expect(table.rows![1][0]).toBe(originalTable.rows![1][0]);
    expect(table.rows![2]).toBe(originalTable.rows![2]);
  });

  it('subscribe fires on every apply/undo/redo with the origin passed through; unsubscribe stops it', () => {
    const store = createBlockStore(SAMPLE_DOCUMENT);
    const events: string[] = [];
    const unsubscribe = store.subscribe((_data, origin) => events.push(origin));

    store.apply(updateBlockContent('blk_title', [{ kind: 'text', text: 'X' }]), 'panel');
    store.undo();
    store.redo();
    expect(events).toEqual(['panel', 'history', 'history']);

    unsubscribe();
    store.apply(updateBlockContent('blk_title', [{ kind: 'text', text: 'Y' }]), 'document');
    expect(events).toEqual(['panel', 'history', 'history']);
  });

  it('mutations that find no matching block/section return data unchanged', () => {
    expect(updateBlockContent('nope', [])(SAMPLE_DOCUMENT)).toBe(SAMPLE_DOCUMENT);
    expect(deleteBlock('nope')(SAMPLE_DOCUMENT)).toBe(SAMPLE_DOCUMENT);
    expect(updateCell('nope', 0, 0, [])(SAMPLE_DOCUMENT)).toBe(SAMPLE_DOCUMENT);
    expect(insertBlock('nope', null, 'paragraph', 'blk_x')(SAMPLE_DOCUMENT)).toBe(SAMPLE_DOCUMENT);
  });

  it('setTheme replaces the theme immutably', () => {
    const newTheme = { ...EMPTY_THEME, h1: { characterFormat: { bold: true } } };
    const next = setTheme(newTheme)(SAMPLE_DOCUMENT);
    expect(next.theme).toBe(newTheme);
    expect(next.sections).toBe(SAMPLE_DOCUMENT.sections);
    expect(SAMPLE_DOCUMENT.theme).toBe(EMPTY_THEME);
  });

  it('no-op apply (returning the same reference) does not pollute history', () => {
    const store = createBlockStore(SAMPLE_DOCUMENT);
    store.apply(updateBlockContent('nope', []), 'panel');
    expect(store.canUndo()).toBe(false);
  });
});
