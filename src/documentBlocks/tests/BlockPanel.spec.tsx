import React from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react';
import BlockPanel from '../BlockPanel';
import { createBlockStore } from '../store';
import { SAMPLE_DOCUMENT } from '../sampleDocument';

describe('BlockPanel', () => {
  it('renders a card per block of SAMPLE_DOCUMENT', () => {
    const store = createBlockStore(SAMPLE_DOCUMENT);
    render(<BlockPanel store={store} />);

    const blockCount = SAMPLE_DOCUMENT.sections.reduce(
      (n, s) => n + s.blocks.length,
      0
    );
    expect(screen.getAllByTestId('docx-block-card')).toHaveLength(blockCount);
  });

  it('typing in a paragraph textarea debounces: no apply per keystroke, exactly one on blur', () => {
    const store = createBlockStore(SAMPLE_DOCUMENT);
    const applySpy = jest.spyOn(store, 'apply');
    render(<BlockPanel store={store} />);

    const textarea = screen.getByDisplayValue(
      'The parties agree to the services below.'
    );
    fireEvent.change(textarea, { target: { value: 'Updated s' } });
    fireEvent.change(textarea, { target: { value: 'Updated sc' } });
    fireEvent.change(textarea, { target: { value: 'Updated scope text.' } });

    // Typing alone must not reach the store — one apply per keystroke would
    // make undo useless while typing.
    expect(applySpy).not.toHaveBeenCalled();

    fireEvent.blur(textarea);

    expect(applySpy).toHaveBeenCalledTimes(1);
    const block = store
      .getData()
      .sections.flatMap((s) => s.blocks)
      .find((b) => b.id === 'blk_scope_p')!;
    expect(block.content).toEqual([
      { kind: 'text', text: 'Updated scope text.' }
    ]);
  });

  it('typing in a paragraph textarea commits after the idle debounce even without blur', () => {
    jest.useFakeTimers();
    const store = createBlockStore(SAMPLE_DOCUMENT);
    render(<BlockPanel store={store} />);

    const textarea = screen.getByDisplayValue(
      'The parties agree to the services below.'
    );
    fireEvent.change(textarea, { target: { value: 'Updated scope text.' } });

    jest.advanceTimersByTime(500);

    const block = store
      .getData()
      .sections.flatMap((s) => s.blocks)
      .find((b) => b.id === 'blk_scope_p')!;
    expect(block.content).toEqual([
      { kind: 'text', text: 'Updated scope text.' }
    ]);
    jest.useRealTimers();
  });

  it('clicking delete removes the block; undo restores it', () => {
    const store = createBlockStore(SAMPLE_DOCUMENT);
    render(<BlockPanel store={store} />);

    const before = store.getData().sections.flatMap((s) => s.blocks).length;
    const deleteButtons = screen.getAllByRole('button', { name: '✕ delete' });
    fireEvent.click(deleteButtons[0]);

    expect(store.getData().sections.flatMap((s) => s.blocks).length).toBe(
      before - 1
    );

    fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
    expect(store.getData().sections.flatMap((s) => s.blocks).length).toBe(
      before
    );
  });

  it('clicking "＋ table" inserts a table block with 3 rows after that card', () => {
    const store = createBlockStore(SAMPLE_DOCUMENT);
    render(<BlockPanel store={store} />);

    const cards = screen.getAllByTestId('docx-block-card');
    const firstCard = cards[0];
    fireEvent.click(
      within(firstCard).getByRole('button', { name: '＋ table' })
    );

    const blocks = store.getData().sections[0].blocks;
    expect(blocks[1].type).toBe('table');
    expect(blocks[1].rows).toHaveLength(3);
  });

  it("editing a computed token's formula through its chip updates spec.formula", () => {
    const store = createBlockStore(SAMPLE_DOCUMENT);
    render(<BlockPanel store={store} />);

    // The "total" token in the pricing table is computed (has a formula) and
    // renders with the ƒ marker.
    fireEvent.click(screen.getByText('total ƒ'));
    const formulaInput = screen.getByDisplayValue('ROUND(retainer * 1.08, 2)');
    fireEvent.change(formulaInput, {
      target: { value: 'ROUND(retainer * 1.10, 2)' }
    });
    fireEvent.submit(formulaInput.closest('form')!);

    const tableBlock = store
      .getData()
      .sections.flatMap((s) => s.blocks)
      .find((b) => b.id === 'blk_pricing_tbl')!;
    const cellInline = tableBlock.rows![2][1].content[0];
    expect(cellInline.kind).toBe('token');
    expect((cellInline as any).spec.formula).toBe('ROUND(retainer * 1.10, 2)');
  });
});
