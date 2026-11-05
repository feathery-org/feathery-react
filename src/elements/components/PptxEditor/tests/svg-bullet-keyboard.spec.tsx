/* eslint-disable no-restricted-globals -- jsdom test */
import React from 'react';
import { importDeck } from '../core/model/import';
import { exportDeckBytes } from '../core/model/export';
import { addTextBox } from '../core/model/edit';
import { refreshShapeText } from '../core/model/read';
import type { Deck, Shape, Slide } from '../core/model/types';
import { SvgSlide } from '../ui/SlideStage';
import { child, childrenOf, el, getAttr } from '../core/opc/xml';
import { act, mountEditor, sampleBytes, type Mounted } from './harness';

let mounted: Mounted | null = null;

afterEach(async () => {
  await mounted?.unmount();
  mounted = null;
  window.getSelection()?.removeAllRanges();
});

async function openBulletEditor(secondTopMargin?: number) {
  mounted = await mountEditor(<SvgSlide />);
  const store = mounted.store;
  let deck!: Deck;
  let slide!: Slide;
  let shape!: Shape;
  await act(async () => {
    store.loadFile(sampleBytes(), 'sample.pptx');
    deck = store.getState().deck!;
    slide = deck.slides[0];
    shape = addTextBox(
      deck,
      slide,
      914400,
      914400,
      3000000,
      900000,
      'First item'
    );
    childrenOf(shape.text!.paragraphs[0].node).unshift(
      el('a:pPr', { lvl: '0', marL: '342900', indent: '-171450' }, [
        el('a:buChar', { char: '•' })
      ])
    );
    if (secondTopMargin !== undefined)
      childrenOf(shape.text!.node).push(
        el('a:p', undefined, [
          el(
            'a:pPr',
            { lvl: '0', marL: String(secondTopMargin), indent: '-171450' },
            [el('a:buChar', { char: '•' })]
          ),
          el('a:r', undefined, [
            el('a:rPr', { lang: 'en-US' }),
            el('a:t', undefined, [{ '#text': 'Back to top' }])
          ])
        ])
      );
    refreshShapeText(shape);
    store.resetHistory();
  });
  await act(async () => store.select(shape.id));
  const host = mounted.host;
  const editor = host.querySelector(
    `[data-shape-id="${shape.id}"] [data-textbody]`
  ) as HTMLElement;
  await act(async () =>
    editor.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }))
  );
  return { deck, slide, shape, editor };
}

function caretAtEnd(paragraph: HTMLElement) {
  const text = paragraph.querySelector('[data-source-run]')!.firstChild!;
  const range = document.createRange();
  range.setStart(text, text.textContent!.length);
  range.collapse(true);
  window.getSelection()!.removeAllRanges();
  window.getSelection()!.addRange(range);
}

function caretAtStart(paragraph: HTMLElement) {
  const text = paragraph.querySelector('[data-source-run]')!.firstChild!;
  const range = document.createRange();
  range.setStart(text, 0);
  range.collapse(true);
  window.getSelection()!.removeAllRanges();
  window.getSelection()!.addRange(range);
}

it('uses Tab and Shift+Tab to change the current bullet level and saves it in XML', async () => {
  const { shape, editor } = await openBulletEditor();
  const paragraph = editor.firstElementChild as HTMLElement;
  caretAtEnd(paragraph);
  await act(async () =>
    editor.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'Tab',
        bubbles: true,
        cancelable: true
      })
    )
  );
  expect(paragraph.dataset.levelOverride).toBe('1');
  expect(paragraph.style.paddingLeft).toBe('84px');
  await act(async () =>
    editor.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'Tab',
        shiftKey: true,
        bubbles: true,
        cancelable: true
      })
    )
  );
  expect(paragraph.dataset.levelOverride).toBe('0');
  await act(async () =>
    editor.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'Tab',
        bubbles: true,
        cancelable: true
      })
    )
  );
  await act(async () => editor.dispatchEvent(new Event('blur')));
  const pPr = child(shape.text!.paragraphs[0].node, 'a:pPr')!;
  expect(getAttr(pPr, 'lvl')).toBe('1');
  expect(getAttr(pPr, 'marL')).toBe('800100');
  expect(getAttr(pPr, 'indent')).toBe('-171450');
});

it('keeps top-level bullets aligned after returning from a nested level', async () => {
  const { shape, editor } = await openBulletEditor(0);
  const first = editor.children[0] as HTMLElement;
  const second = editor.children[1] as HTMLElement;
  expect(second.style.paddingLeft).toBe(first.style.paddingLeft);
  expect(
    (second.querySelector('[data-bullet]') as HTMLElement).style.left
  ).toBe((first.querySelector('[data-bullet]') as HTMLElement).style.left);
  caretAtEnd(second);
  await act(async () =>
    editor.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'Tab',
        bubbles: true,
        cancelable: true
      })
    )
  );
  await act(async () =>
    editor.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'Tab',
        shiftKey: true,
        bubbles: true,
        cancelable: true
      })
    )
  );
  expect(second.style.paddingLeft).toBe(first.style.paddingLeft);
  await act(async () => editor.dispatchEvent(new Event('blur')));
  expect(
    shape.text!.paragraphs.map((p) => getAttr(child(p.node, 'a:pPr')!, 'marL'))
  ).toEqual(['342900', '342900']);
});

it('keeps Shift+Enter inside one bullet as a saved DrawingML soft break', async () => {
  const { deck, shape, editor } = await openBulletEditor();
  const first = editor.firstElementChild as HTMLElement;
  caretAtEnd(first);
  await act(async () =>
    editor.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'Enter',
        shiftKey: true,
        bubbles: true,
        cancelable: true
      })
    )
  );
  expect(editor.children).toHaveLength(1);
  expect(first.querySelector('br[data-soft-break]')).not.toBeNull();
  expect(first.style.textIndent).toBe('0px');
  expect(
    (first.querySelector('[data-bullet]') as HTMLElement).style.position
  ).toBe('absolute');
  expect((first.querySelector('[data-bullet]') as HTMLElement).style.left).toBe(
    '18px'
  );
  first.appendChild(document.createTextNode('continued line'));
  await act(async () => editor.dispatchEvent(new Event('blur')));
  expect(shape.text!.paragraphs).toHaveLength(1);
  expect(shape.text!.paragraphs[0].runs.map((r) => r.text)).toEqual([
    'First item',
    '\n',
    'continued line'
  ]);
  expect(shape.text!.paragraphs[0].bullet?.kind).toBe('char');
  const saved = importDeck(exportDeckBytes(deck)).slides[0].shapes.find(
    (s) => s.id === shape.id
  )!;
  expect(saved.text!.paragraphs[0].runs.map((r) => r.text)).toEqual([
    'First item',
    '\n',
    'continued line'
  ]);
});

it('creates another bullet paragraph from Enter and retains its bullet on commit', async () => {
  const { shape, editor } = await openBulletEditor();
  const first = editor.firstElementChild as HTMLElement;
  caretAtEnd(first);
  await act(async () =>
    editor.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'Enter',
        bubbles: true,
        cancelable: true
      })
    )
  );
  expect(editor.children).toHaveLength(2);
  const second = editor.children[1] as HTMLElement;
  expect(second.querySelector('[data-bullet]')?.textContent).toContain('•');
  second.appendChild(document.createTextNode('Second item'));
  await act(async () => editor.dispatchEvent(new Event('blur')));
  expect(
    shape.text!.paragraphs.map((p) => p.runs.map((r) => r.text).join(''))
  ).toEqual(['First item', 'Second item']);
  expect(shape.text!.paragraphs.map((p) => p.bullet?.kind)).toEqual([
    'char',
    'char'
  ]);
});

it('turns a bullet into plain text when Backspace is pressed at its start', async () => {
  const { deck, shape, editor } = await openBulletEditor();
  const paragraph = editor.firstElementChild as HTMLElement;
  caretAtStart(paragraph);
  await act(async () =>
    editor.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'Backspace',
        bubbles: true,
        cancelable: true
      })
    )
  );
  expect(paragraph.querySelector('[data-bullet]')).toBeNull();
  expect(paragraph.style.paddingLeft).toBe('0px');
  await act(async () => editor.dispatchEvent(new Event('blur')));
  expect(shape.text!.paragraphs[0].runs.map((r) => r.text).join('')).toBe(
    'First item'
  );
  expect(shape.text!.paragraphs[0].bullet?.kind).toBe('none');
  const pPr = child(shape.text!.paragraphs[0].node, 'a:pPr')!;
  expect(child(pPr, 'a:buNone')).not.toBeUndefined();
  expect(getAttr(pPr, 'marL')).toBe('0');
  const saved = importDeck(exportDeckBytes(deck)).slides[0].shapes.find(
    (s) => s.id === shape.id
  )!;
  expect(saved.text!.paragraphs[0].bullet?.kind).toBe('none');
});

it('turns a newly created empty bullet into a plain paragraph on Backspace', async () => {
  const { shape, editor } = await openBulletEditor();
  caretAtEnd(editor.firstElementChild as HTMLElement);
  await act(async () =>
    editor.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'Enter',
        bubbles: true,
        cancelable: true
      })
    )
  );
  const empty = editor.children[1] as HTMLElement;
  await act(async () =>
    editor.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'Backspace',
        bubbles: true,
        cancelable: true
      })
    )
  );
  expect(empty.querySelector('[data-bullet]')).toBeNull();
  await act(async () => editor.dispatchEvent(new Event('blur')));
  expect(shape.text!.paragraphs.map((p) => p.bullet?.kind)).toEqual([
    'char',
    'none'
  ]);
});

it('navigates from the first bullet into a newly created empty second bullet so it can be deleted', async () => {
  const { editor } = await openBulletEditor();
  const first = editor.firstElementChild as HTMLElement;
  caretAtEnd(first);
  await act(async () =>
    editor.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'Enter',
        bubbles: true,
        cancelable: true
      })
    )
  );
  const second = editor.children[1] as HTMLElement;
  let anchor = window.getSelection()?.anchorNode;
  let anchorElement =
    anchor instanceof Element ? anchor : anchor?.parentElement;
  expect(anchorElement?.closest('[data-bullet-item]')).toBe(second);
  expect(anchor?.textContent).toBe('​');
  expect(window.getSelection()?.anchorOffset).toBe(1);
  caretAtEnd(first);
  await act(async () =>
    editor.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'ArrowDown',
        bubbles: true,
        cancelable: true
      })
    )
  );
  anchor = window.getSelection()?.anchorNode;
  anchorElement = anchor instanceof Element ? anchor : anchor?.parentElement;
  expect(anchorElement?.closest('[data-bullet-item]')).toBe(second);
  await act(async () =>
    editor.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'Backspace',
        bubbles: true,
        cancelable: true
      })
    )
  );
  expect(second.querySelector('[data-bullet]')).toBeNull();
});

it('deletes the bullet when the browser normalizes the caret to the text-body boundary', async () => {
  const { editor } = await openBulletEditor();
  caretAtEnd(editor.firstElementChild as HTMLElement);
  await act(async () =>
    editor.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'Enter',
        bubbles: true,
        cancelable: true
      })
    )
  );
  const second = editor.children[1] as HTMLElement;
  const range = document.createRange();
  range.setStart(editor, 2);
  range.collapse(true);
  window.getSelection()!.removeAllRanges();
  window.getSelection()!.addRange(range);
  await act(async () =>
    editor.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'Backspace',
        bubbles: true,
        cancelable: true
      })
    )
  );
  expect(second.querySelector('[data-bullet]')).toBeNull();
});
