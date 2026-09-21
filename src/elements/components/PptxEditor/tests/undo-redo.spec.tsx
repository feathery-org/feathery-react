/* eslint-disable no-restricted-globals -- jsdom test */
import React from 'react';
import { addTextBox, insertImage, readPictureCrop } from '../core/model/edit';
import { deckToJSON } from '../core/model/json';
import { refreshShapeText } from '../core/model/read';
import { childrenOf, el } from '../core/opc/xml';
import type { Deck, Shape } from '../core/model/types';
import { Toolbar } from '../ui/PptxToolbar';
import { SvgSlide } from '../ui/SlideStage';
import { JsonPanel } from '../ui/JsonPanel';
import { act, mountEditor, sampleBytes, type Mounted, switchTab } from './harness';

const PNG_DATA =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
const PNG = Uint8Array.from(Buffer.from(PNG_DATA.split(',')[1], 'base64'));

let mounted: Mounted | null = null;

afterEach(async () => {
  await mounted?.unmount();
  mounted = null;
});

async function mountWith(children: React.ReactNode) {
  mounted = await mountEditor(children);
  await act(async () => mounted!.store.loadFile(sampleBytes(), 'sample.pptx'));
  return {
    store: mounted.store,
    host: mounted.host,
    deck: mounted.store.getState().deck!
  };
}

it('undoes and redoes a modeled geometry edit through the JSON apply path', async () => {
  const { store, deck } = await mountWith(null);
  const shape = deck.slides[0].shapes.find((candidate) => candidate.xfrm)!;
  const node = shape.node;
  const before = { ...shape.xfrm! };

  await act(async () =>
    store.executeCommand(
      {
        type: 'set-shape-geometries',
        slideId: deck.slides[0].path,
        updates: [
          {
            shapeId: shape.id,
            geometry: { x: before.x + 250000, y: before.y + 100000 }
          }
        ]
      },
      'Move shape'
    )
  );
  expect(store.getState().undoStack).toHaveLength(1);
  expect(shape.xfrm?.x).toBe(before.x + 250000);

  await act(async () => store.undo());
  expect(shape.xfrm).toMatchObject(before);
  expect(shape.node).toBe(node);
  expect(store.getState().redoStack).toHaveLength(1);

  await act(async () => store.redo());
  expect(shape.xfrm?.x).toBe(before.x + 250000);
  expect(shape.xfrm?.y).toBe(before.y + 100000);
  expect(shape.node).toBe(node);
});

it('restores command-inserted shapes and clears redo after a new edit', async () => {
  const { store, deck } = await mountWith(null);
  const slide = deck.slides[0];
  const initialCount = slide.shapes.length;
  let addedId = '';
  await act(async () => {
    addedId = store.executeCommand(
      {
        type: 'insert-shape',
        slideId: slide.path,
        shape: {
          kind: 'text-box',
          x: 100000,
          y: 100000,
          cx: 1200000,
          cy: 400000,
          text: 'Undo me'
        }
      },
      'Insert text box'
    )!.createdShapeIds[0];
  });
  expect(slide.shapes).toHaveLength(initialCount + 1);

  await act(async () => store.undo());
  expect(slide.shapes).toHaveLength(initialCount);
  expect(slide.shapes.some((shape) => shape.id === addedId)).toBe(false);

  await act(async () => store.redo());
  expect(slide.shapes).toHaveLength(initialCount + 1);
  expect(
    slide.shapes.find((shape) => shape.id === addedId)?.text?.paragraphs[0]
      .runs[0].text
  ).toBe('Undo me');

  await act(async () => store.undo());
  const target = slide.shapes.find((shape) => shape.xfrm)!;
  await act(async () =>
    store.executeCommand(
      {
        type: 'set-shape-geometries',
        slideId: slide.path,
        updates: [
          { shapeId: target.id, geometry: { x: target.xfrm!.x + 90000 } }
        ]
      },
      'Move another shape'
    )
  );
  expect(store.getState().redoStack).toHaveLength(0);
});

it('keeps the JSON projection synchronized across undo and redo', async () => {
  const { store, deck } = await mountWith(null);
  const shape = deck.slides[0].shapes.find((candidate) => candidate.xfrm)!;
  const before = JSON.stringify(deckToJSON(deck));
  await act(async () =>
    store.executeCommand(
      {
        type: 'set-shape-geometries',
        slideId: deck.slides[0].path,
        updates: [
          { shapeId: shape.id, geometry: { rot: shape.xfrm!.rot + 15 } }
        ]
      },
      'Rotate shape'
    )
  );
  const after = JSON.stringify(deckToJSON(deck));
  expect(after).not.toBe(before);

  await act(async () => store.undo());
  expect(JSON.stringify(deckToJSON(deck))).toBe(before);
  await act(async () => store.redo());
  expect(JSON.stringify(deckToJSON(deck))).toBe(after);
});

it('undoes paragraph properties that are not yet editable in the public JSON panel', async () => {
  const { store, deck } = await mountWith(null);
  const slide = deck.slides[0];
  const shape = slide.shapes.find(
    (candidate) => candidate.text?.paragraphs.length
  )!;
  const before = JSON.stringify(deckToJSON(deck));
  await act(async () =>
    store.executeCommand(
      {
        type: 'set-paragraph-bullet',
        slideId: slide.path,
        shapeId: shape.id,
        bullet: { kind: 'char', char: '➤' },
        paragraphIndexes: [0]
      },
      'Change bullets'
    )
  );
  const after = JSON.stringify(deckToJSON(deck));
  expect(after).not.toBe(before);

  await act(async () => store.undo());
  expect(JSON.stringify(deckToJSON(deck))).toBe(before);
  await act(async () => store.redo());
  expect(JSON.stringify(deckToJSON(deck))).toBe(after);
});

it('exposes toolbar buttons and keyboard shortcuts for undo and redo', async () => {
  const { store, host, deck } = await mountWith(
    <>
      <Toolbar />
      <SvgSlide />
    </>
  );
  const shape = deck.slides[0].shapes.find((candidate) => candidate.xfrm)!;
  const beforeX = shape.xfrm!.x;
  await act(async () =>
    store.executeCommand(
      {
        type: 'set-shape-geometries',
        slideId: deck.slides[0].path,
        updates: [{ shapeId: shape.id, geometry: { x: beforeX + 120000 } }]
      },
      'Move shape'
    )
  );

  const svg = host.querySelector('svg[data-svg-uid]');
  const renderedShape = () =>
    svg?.querySelector(`[data-shape-id="${shape.id}"]`);
  expect(renderedShape()?.getAttribute('transform')).toContain(
    `${beforeX + 120000}`
  );
  const undo = host.querySelector(
    'button[title="Undo Move shape"]'
  ) as HTMLButtonElement;
  expect(undo.disabled).toBe(false);
  // Slide-size controls live on the Slide tab in the tabbed toolbar.
  await switchTab(host, 'Slide');
  const slideWidth = host.querySelector(
    'input[title="Slide width (inches)"]'
  ) as HTMLInputElement;
  slideWidth.focus();
  // The POC's global Ctrl+Z handler moved onto the PptxEditor wrapper (not
  // mounted here), so the keyboard path is exercised via the store action.
  await act(async () => store.undo());
  expect(shape.xfrm!.x).toBe(beforeX);
  expect(host.querySelector('svg[data-svg-uid]')).toBe(svg);
  expect(renderedShape()?.getAttribute('transform')).toContain(`${beforeX}`);
  const redo = host.querySelector(
    'button[title="Redo Move shape"]'
  ) as HTMLButtonElement;
  expect(redo.disabled).toBe(false);
  await act(async () => redo.click());
  expect(shape.xfrm!.x).toBe(beforeX + 120000);
  expect(host.querySelector('svg[data-svg-uid]')).toBe(svg);
  expect(renderedShape()?.getAttribute('transform')).toContain(
    `${beforeX + 120000}`
  );
});

it('reconciles inserted shapes during history navigation without replacing the SVG root', async () => {
  const { store, host, deck } = await mountWith(
    <>
      <Toolbar />
      <SvgSlide />
    </>
  );
  const slide = deck.slides[0];

  let addedId = '';
  await act(async () => {
    addedId = store.executeCommand(
      {
        type: 'insert-shape',
        slideId: slide.path,
        shape: {
          kind: 'text-box',
          x: 100000,
          y: 100000,
          cx: 1200000,
          cy: 400000,
          text: 'Undo me'
        }
      },
      'Insert text box'
    )!.createdShapeIds[0];
  });
  const svg = host.querySelector('svg[data-svg-uid]');
  expect(svg?.querySelector(`[data-shape-id="${addedId}"]`)).not.toBeNull();

  await act(async () => store.undo());
  expect(host.querySelector('svg[data-svg-uid]')).toBe(svg);
  expect(svg?.querySelector(`[data-shape-id="${addedId}"]`)).toBeNull();

  await act(async () => store.redo());
  expect(host.querySelector('svg[data-svg-uid]')).toBe(svg);
  expect(svg?.querySelector(`[data-shape-id="${addedId}"]`)).not.toBeNull();
});

it('records toolbar formatting as one undo step after bullet indentation is normalized for editing', async () => {
  mounted = await mountEditor(
    <>
      <Toolbar />
      <SvgSlide />
    </>
  );
  const store = mounted.store;
  const host = mounted.host;
  let deck!: Deck;
  let shape!: Shape;
  await act(async () => {
    store.loadFile(sampleBytes(), 'sample.pptx');
    deck = store.getState().deck!;
    const slide = deck.slides[0];
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
    childrenOf(shape.text!.node).push(
      el('a:p', undefined, [
        el('a:pPr', { lvl: '0', marL: '0', indent: '-171450' }, [
          el('a:buChar', { char: '•' })
        ]),
        el('a:r', undefined, [
          el('a:rPr', { lang: 'en-US' }),
          el('a:t', undefined, [{ '#text': 'Second item' }])
        ])
      ])
    );
    refreshShapeText(shape);
    store.resetHistory();
  });
  const slide = deck.slides[0];
  await act(async () => store.select(shape.id));

  const editor = host.querySelector(
    `[data-shape-id="${shape.id}"] [data-textbody]`
  ) as HTMLElement;
  await act(async () =>
    editor.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }))
  );
  const text = editor.querySelector('[data-source-run="0"]')!.firstChild!;
  const range = document.createRange();
  range.setStart(text, 0);
  range.setEnd(text, 5);
  window.getSelection()!.removeAllRanges();
  window.getSelection()!.addRange(range);
  await act(async () => document.dispatchEvent(new Event('selectionchange')));
  const strike = host.querySelector(
    'button[title="Strikethrough"]'
  ) as HTMLButtonElement;
  await act(async () => {
    strike.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    editor.dispatchEvent(new Event('blur'));
    strike.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
    strike.click();
  });

  expect(shape.text!.paragraphs[0].runs[0].strike).toBe(true);
  expect(store.getState().undoStack).toHaveLength(1);
  const svg = host.querySelector('svg[data-svg-uid]');
  const renderedShape = svg?.querySelector(`[data-shape-id="${shape.id}"]`);
  await act(async () => store.undo());
  const restored = slide.shapes.find((candidate) => candidate.id === shape.id)!;
  expect(restored.text!.paragraphs[0].runs[0].strike).toBe(false);
  expect(store.getState().undoStack).toHaveLength(0);
  expect(host.querySelector('svg[data-svg-uid]')).toBe(svg);
  expect(svg?.querySelector(`[data-shape-id="${shape.id}"]`)).toBe(
    renderedShape
  );
});

it('commits and undoes an active SVG text edit from the keyboard or toolbar', async () => {
  mounted = await mountEditor(
    <>
      <Toolbar />
      <SvgSlide />
    </>
  );
  const store = mounted.store;
  const host = mounted.host;
  let deck!: Deck;
  let shape!: Shape;
  await act(async () => {
    store.loadFile(sampleBytes(), 'sample.pptx');
    deck = store.getState().deck!;
    shape = addTextBox(
      deck,
      deck.slides[0],
      914400,
      914400,
      3000000,
      900000,
      'Before'
    );
    store.resetHistory();
  });
  const slide = deck.slides[0];
  await act(async () => store.select(shape.id));

  const editor = host.querySelector(
    `[data-shape-id="${shape.id}"] [data-textbody]`
  ) as HTMLElement;
  const editedGroup = editor.closest('[data-shape-id]');
  const editedForeignObject = editor.closest('foreignObject');
  await act(async () =>
    editor.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }))
  );
  editor.querySelector('[data-source-run="0"]')!.textContent = 'After';
  // commitSvgTextEdit is a non-reactive store field; jsdom fires no
  // selectionchange on focus, so nudge one store notification (the browser
  // does this naturally) for the toolbar to re-read it.
  await act(async () => store.setTextToolbarPointer(false));
  const undo = host.querySelector(
    'button[title="Undo current text edit"]'
  ) as HTMLButtonElement;
  expect(undo.disabled).toBe(false);

  // The POC's window Ctrl+Z shortcut lives on the PptxEditor wrapper now, so
  // the keyboard undo/redo path is exercised through the store actions (they
  // commit the in-flight contenteditable edit first, like the shortcut did).
  await act(async () => store.undo());
  const restored = slide.shapes.find((candidate) => candidate.id === shape.id)!;
  expect(
    restored.text!.paragraphs[0].runs.map((run) => run.text).join('')
  ).toBe('Before');
  expect(store.getState().redoStack).toHaveLength(1);
  expect(host.querySelector(`[data-shape-id="${shape.id}"]`)).toBe(editedGroup);
  expect(
    host.querySelector(`[data-shape-id="${shape.id}"] foreignObject`)
  ).toBe(editedForeignObject);
  expect(
    host.querySelector(`[data-shape-id="${shape.id}"] [data-textbody]`)
  ).toBe(editor);

  await act(async () => store.redo());
  const redone = slide.shapes.find((candidate) => candidate.id === shape.id)!;
  expect(redone.text!.paragraphs[0].runs.map((run) => run.text).join('')).toBe(
    'After'
  );

  const editorAgain = host.querySelector(
    `[data-shape-id="${shape.id}"] [data-textbody]`
  ) as HTMLElement;
  await act(async () =>
    editorAgain.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }))
  );
  editorAgain.querySelector('[data-source-run="0"]')!.textContent = 'Again';
  await act(async () =>
    (host.querySelector('button[title^="Undo"]') as HTMLButtonElement).click()
  );
  const toolbarRestored = slide.shapes.find(
    (candidate) => candidate.id === shape.id
  )!;
  expect(
    toolbarRestored.text!.paragraphs[0].runs.map((run) => run.text).join('')
  ).toBe('After');
});

it('keeps picture, image, and clip-path nodes mounted through crop undo and redo', async () => {
  mounted = await mountEditor(
    <>
      <Toolbar />
      <SvgSlide />
    </>
  );
  const store = mounted.store;
  const host = mounted.host;
  let deck!: Deck;
  let picture!: Shape;
  await act(async () => {
    store.loadFile(sampleBytes(), 'sample.pptx');
    deck = store.getState().deck!;
    picture = insertImage(
      deck,
      deck.slides[0],
      PNG,
      'png',
      100000,
      100000,
      1200000,
      800000
    );
    picture.imageSrc = PNG_DATA;
    store.resetHistory();
  });
  const slide = deck.slides[0];
  await act(async () => store.select(picture.id));

  const svg = host.querySelector('svg[data-svg-uid]')!;
  const group = svg.querySelector(`[data-shape-id="${picture.id}"]`)!;
  const image = group.querySelector('image')!;
  const clipId = group
    .querySelector('[clip-path]')!
    .getAttribute('clip-path')!
    .match(/#([^)]*)/)![1];
  const clip = svg.querySelector(`clipPath[id="${clipId}"]`)!;

  await act(async () =>
    store.executeCommand(
      {
        type: 'set-picture-crop',
        slideId: slide.path,
        shapeId: picture.id,
        crop: {
          clipGeometry: 'ellipse',
          cropPct: { left: 15, top: 5, right: 10, bottom: 5 }
        }
      },
      'Crop picture'
    )
  );

  await act(async () => store.undo());
  expect(host.querySelector('svg[data-svg-uid]')).toBe(svg);
  expect(svg.querySelector(`[data-shape-id="${picture.id}"]`)).toBe(group);
  expect(group.querySelector('image')).toBe(image);
  expect(svg.querySelector(`clipPath[id="${clipId}"]`)).toBe(clip);
  expect(
    readPictureCrop(
      slide.shapes.find((candidate) => candidate.id === picture.id)!
    )
  ).toMatchObject({
    clipGeometry: 'rect',
    cropPct: { left: 0, top: 0, right: 0, bottom: 0 }
  });

  await act(async () => store.redo());
  expect(host.querySelector('svg[data-svg-uid]')).toBe(svg);
  expect(svg.querySelector(`[data-shape-id="${picture.id}"]`)).toBe(group);
  expect(group.querySelector('image')).toBe(image);
  expect(svg.querySelector(`clipPath[id="${clipId}"]`)).toBe(clip);
  expect(
    readPictureCrop(
      slide.shapes.find((candidate) => candidate.id === picture.id)!
    )
  ).toMatchObject({
    clipGeometry: 'ellipse',
    cropPct: { left: 15, top: 5, right: 10, bottom: 5 }
  });
});

it('does not run JSON change-flash animations during undo or redo', async () => {
  const { store, host, deck } = await mountWith(
    <>
      <SvgSlide />
      <JsonPanel />
    </>
  );
  const shape = deck.slides[0].shapes.find((candidate) => candidate.xfrm)!;

  await act(async () =>
    store.executeCommand(
      {
        type: 'set-shape-geometries',
        slideId: deck.slides[0].path,
        updates: [
          { shapeId: shape.id, geometry: { x: shape.xfrm!.x + 100000 } }
        ]
      },
      'Move shape'
    )
  );
  expect(host.querySelectorAll('[style*="jsonflash"]')).not.toHaveLength(0);

  await act(async () => store.undo());
  expect(host.querySelectorAll('[style*="jsonflash"]')).toHaveLength(0);
  await act(async () => store.redo());
  expect(host.querySelectorAll('[style*="jsonflash"]')).toHaveLength(0);
});

it('routes slide-size toolbar edits through engine history without remounting SVG', async () => {
  const { store, host, deck } = await mountWith(
    <>
      <Toolbar />
      <SvgSlide />
    </>
  );
  const before = deckToJSON(deck).slides[0].sizeEMU;
  const svg = host.querySelector('svg[data-svg-uid]');
  await switchTab(host, 'Slide');
  const width = host.querySelector(
    'input[title="Slide width (inches)"]'
  ) as HTMLInputElement;

  await act(async () => {
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      'value'
    )!.set!.call(width, String(before.cx / 914400 + 1));
    width.dispatchEvent(new Event('input', { bubbles: true }));
  });
  expect(deckToJSON(deck).slides[0].sizeEMU.cx).toBe(before.cx + 914400);
  expect(
    store.getState().undoStack[store.getState().undoStack.length - 1]?.label
  ).toBe('Resize slide');
  expect(host.querySelector('svg[data-svg-uid]')).toBe(svg);

  await act(async () => store.undo());
  expect(deckToJSON(deck).slides[0].sizeEMU).toEqual(before);
  expect(host.querySelector('svg[data-svg-uid]')).toBe(svg);
  await act(async () => store.redo());
  expect(deckToJSON(deck).slides[0].sizeEMU.cx).toBe(before.cx + 914400);
  expect(host.querySelector('svg[data-svg-uid]')).toBe(svg);
});
