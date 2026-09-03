import React from 'react';
import { render, screen } from '@testing-library/react';
import ButtonElement from '../ButtonElement';
import ResponsiveStyles from '../../styles';
import { initState } from '../../../utils/init';

const BASE_STYLES = {
  flex_direction: 'row',
  content_align: 'center',
  horizontal_align: 'center',
  height: 100,
  height_unit: 'px',
  background_color: 'ffffff',
  border_top_color: '000000',
  border_right_color: '000000',
  border_bottom_color: '000000',
  border_left_color: '000000'
};

const makeElement = (properties: any = {}) => ({
  id: 'btn-1',
  properties: {
    submit: false,
    actions: [{ type: 'next' }],
    ...properties
  },
  styles: BASE_STYLES,
  repeat: null
});

const renderButton = (element: any, loader: any, featheryContext?: any) =>
  render(
    <ButtonElement
      element={element}
      responsiveStyles={new ResponsiveStyles(element, ['button'], true, 478)}
      editMode={false}
      loader={loader}
      featheryContext={featheryContext}
    />
  );

// Rules emotion emitted, since jsdom's cssstyle drops calc() and aspect-ratio
// from getComputedStyle and emotion inserts through insertRule
const emittedCss = () =>
  Array.from(document.styleSheets)
    .flatMap((sheet) => Array.from(sheet.cssRules ?? []))
    .map((rule) => rule.cssText)
    .join('');

// The rule emotion emitted for one element, so an assertion cannot be satisfied
// by some other element that happens to carry the same declaration
const ruleFor = (el: HTMLElement) =>
  emittedCss().match(
    new RegExp(`\\.${el.className.split(' ')[0]}\\s*\\{[^}]*\\}`)
  )?.[0] ?? '';

// One path for every button: the loader is drawn over the content and clamped
// to the box the button already has, so the button can never resize
const expectOverlaidAndClamped = (loader: HTMLElement) => {
  const box = loader.parentElement as HTMLElement;
  const overlay = box.parentElement as HTMLElement;
  const rule = ruleFor(box);
  expect(rule).toContain('max-width: calc(100% - 4px)');
  expect(rule).toContain('max-height: calc(100% - 4px)');
  expect(getComputedStyle(overlay).position).toBe('absolute');
  expect(overlay.parentElement?.tagName).toBe('BUTTON');
};

beforeAll(() => {
  (window as any).matchMedia = () => ({
    matches: true,
    addListener() {},
    removeListener() {}
  });
});

// A known field the respondent hasn't filled renders empty, which one of the
// cases below relies on. It lives on a module singleton, so put it back after.
beforeEach(() => initState.knownFieldKeys.add('unfilled'));
afterEach(() => initState.knownFieldKeys.delete('unfilled'));

describe('ButtonElement loader', () => {
  const labelled = () =>
    makeElement({
      text: 'Submit my application',
      text_formatted: [{ insert: 'Submit my application' }],
      image: 'https://example.com/icon.png'
    });

  it('hides the content in place rather than unmounting it', () => {
    const element = labelled();
    const styles = new ResponsiveStyles(element, ['button'], true, 478);
    const props: any = { element, responsiveStyles: styles, editMode: false };

    const { rerender } = render(<ButtonElement {...props} loader={null} />);
    const img = document.querySelector('button img');
    expect(img).toBeTruthy();

    rerender(
      <ButtonElement {...props} loader={<span data-testid='loader' />} />
    );

    // Same node, so the image is never torn down and reloaded mid-click - a
    // fresh img has no intrinsic size until it decodes, which would collapse
    // a fit-width button for a frame
    expect(document.querySelector('button img')).toBe(img);
    expect(screen.getByTestId('loader')).toBeTruthy();
  });

  it('keeps the hidden content in the layout while loading', () => {
    renderButton(labelled(), <span data-testid='loader' />);

    const img = document.querySelector('button img') as HTMLElement;
    // `display: contents` keeps the flex layout identical; hidden visibility
    // still contributes the content's size, so the button can't resize
    const wrapper = img.parentElement as HTMLElement;
    expect(getComputedStyle(wrapper).display).toBe('contents');
    expect(getComputedStyle(wrapper).visibility).toBe('hidden');
  });

  it('leaves the content visible when there is no loader', () => {
    renderButton(labelled(), null);

    const wrapper = (document.querySelector('button img') as HTMLElement)
      .parentElement as HTMLElement;
    expect(getComputedStyle(wrapper).visibility).not.toBe('hidden');
  });

  it('overlays and clamps the loader', () => {
    renderButton(labelled(), <span data-testid='loader' />);

    expectOverlaidAndClamped(screen.getByTestId('loader'));
  });

  it('centres the loader in the button', () => {
    renderButton(labelled(), <span data-testid='loader' />);

    // A loader that scaled down should still sit in the middle rather than
    // wherever the hidden label happened to be aligned
    const overlay = (screen.getByTestId('loader').parentElement as HTMLElement)
      .parentElement as HTMLElement;
    const overlayStyles = getComputedStyle(overlay);
    expect(overlayStyles.alignItems).toBe('center');
    expect(overlayStyles.justifyContent).toBe('center');
  });

  // Whatever the label renders, the button keeps its size and the loader
  // scales to fit it. There is no second path that lets the loader size the
  // button, so none of these can collapse it.
  it.each([
    ['a whitespace-only label', { text: ' ', text_formatted: [{ insert: ' ' }] }, undefined],
    [
      'a label of only an unfilled text variable',
      { text: '{{unfilled}}', text_formatted: [{ insert: '{{unfilled}}' }] },
      undefined
    ],
    [
      'a data-bound label resolving to empty',
      {
        text: 'Placeholder label',
        text_formatted: [{ insert: 'Placeholder label' }],
        text_mode: 'data',
        text_source: 'feathery.empty'
      },
      { empty: '' }
    ],
    [
      'a data-bound label resolving to a boolean',
      {
        text: 'Placeholder label',
        text_formatted: [{ insert: 'Placeholder label' }],
        text_mode: 'data',
        text_source: 'feathery.flag'
      },
      { flag: false }
    ],
    ['no text and no image', {}, undefined]
  ])('overlays and clamps the loader for %s', (_label, properties, context) => {
    renderButton(
      makeElement(properties as any),
      <span data-testid='loader' />,
      context
    );

    expectOverlaidAndClamped(screen.getByTestId('loader'));
  });

  it('leaves room between a scaled-down loader and the button border', () => {
    // The clamp measures against the button's padding box now, so without a
    // gap a loader that had to scale down sits flush against the corner radius
    renderButton(labelled(), <span data-testid='loader' />);

    const box = screen.getByTestId('loader').parentElement as HTMLElement;
    const rule = ruleFor(box);
    expect(rule).toContain('max-width: calc(100% - 4px)');
    // the same box still carries the loader target's size, halved from the button
    expect(rule).toContain('width: 50px');
  });

  it('sizes a percentage loader from its height so it stays square', () => {
    // width and height percentages resolve against different lengths, which
    // gave a wide flat box with the spinner drawn tiny inside it
    const element = makeElement({
      text: 'Submit',
      text_formatted: [{ insert: 'Submit' }]
    });
    element.styles = { ...BASE_STYLES, height_unit: '%' } as any;
    renderButton(element, <span data-testid='loader' />);

    const box = screen.getByTestId('loader').parentElement as HTMLElement;
    expect(getComputedStyle(box).height).toBe('50%');
    expect(getComputedStyle(box).width).not.toBe('50%');
    expect(emittedCss()).toMatch(/aspect-ratio:\s*1/);
  });
});
