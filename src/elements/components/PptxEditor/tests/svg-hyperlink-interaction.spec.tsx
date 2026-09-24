/* eslint-disable no-restricted-globals -- jsdom test */
import React from 'react';
import { SvgSlide } from '../ui/SlideStage';
import { addTextBox } from '../core/model/edit';
import { refreshShapeText } from '../core/model/read';
import type { Deck, Shape, Slide } from '../core/model/types';
import { childrenOf, child, el } from '../core/opc/xml';
import { act, mountEditor, sampleBytes, type Mounted } from './harness';

let mounted: Mounted | null = null;

afterEach(async () => {
  jest.restoreAllMocks();
  await mounted?.unmount();
  mounted = null;
});

function addRunLink(shape: Shape, relationshipId: string, action?: string) {
  const run = shape.text!.paragraphs[0].runs[0];
  const rPr = run.rPr || el('a:rPr');
  if (!run.rPr) childrenOf(run.node).unshift(rPr);
  childrenOf(rPr).push(
    el('a:hlinkClick', {
      'r:id': relationshipId,
      ...(action ? { action } : {})
    })
  );
  refreshShapeText(shape);
}

async function mountLinked(
  setup: (deck: Deck, slide: Slide) => void
): Promise<HTMLAnchorElement> {
  mounted = await mountEditor(<SvgSlide />);
  const store = mounted.store;
  await act(async () => {
    store.loadFile(sampleBytes(), 'sample.pptx');
    const deck = store.getState().deck!;
    setup(deck, deck.slides[0]);
    store.resetHistory();
  });
  return mounted.host.querySelector('a[data-hyperlink]') as HTMLAnchorElement;
}

it('opens an external run hyperlink after the complete mouse click sequence', async () => {
  const link = await mountLinked((deck, slide) => {
    const shape = addTextBox(
      deck,
      slide,
      914400,
      914400,
      3000000,
      600000,
      'Open docs'
    );
    const relationshipId = deck.pkg.addRelationship(
      slide.path,
      'http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink',
      'https://example.com/docs',
      true
    );
    addRunLink(shape, relationshipId);
  });
  const open = jest.spyOn(window, 'open').mockImplementation(() => null);

  await act(async () => {
    link.dispatchEvent(
      new MouseEvent('mousedown', { bubbles: true, cancelable: true })
    );
    link.dispatchEvent(
      new MouseEvent('mouseup', { bubbles: true, cancelable: true })
    );
    link.dispatchEvent(
      new MouseEvent('click', { bubbles: true, cancelable: true })
    );
  });

  expect(open).toHaveBeenCalledWith(
    'https://example.com/docs',
    '_blank',
    'noopener,noreferrer'
  );
});

it('navigates an internal PowerPoint hyperlink to its target slide', async () => {
  let shape!: Shape;
  const link = await mountLinked((deck, slide) => {
    const target = deck.slides[1];
    shape = addTextBox(
      deck,
      slide,
      914400,
      914400,
      3000000,
      600000,
      'Next slide'
    );
    const relationshipId = deck.pkg.addRelationship(
      slide.path,
      'http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide',
      target.path.split('/').at(-1)!
    );
    addRunLink(shape, relationshipId, 'ppaction://hlinksldjump');
  });

  await act(async () =>
    link.dispatchEvent(
      new MouseEvent('click', { bubbles: true, cancelable: true })
    )
  );

  expect(
    child(shape.text!.paragraphs[0].runs[0].rPr!, 'a:hlinkClick')
  ).toBeTruthy();
  expect(mounted!.store.getState().activeSlide).toBe(1);
});
