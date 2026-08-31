import React from 'react';
import { render, screen } from '@testing-library/react';
import ButtonElement from '../ButtonElement';
import ResponsiveStyles from '../../styles';

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

const renderButton = (element: any, loader: any) =>
  render(
    <ButtonElement
      element={element}
      responsiveStyles={new ResponsiveStyles(element, ['button'], true, 478)}
      editMode={false}
      loader={loader}
    />
  );

beforeAll(() => {
  (window as any).matchMedia = () => ({
    matches: true,
    addListener() {},
    removeListener() {}
  });
});

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

  it('clamps the loader to the button when content holds the size open', () => {
    renderButton(labelled(), <span data-testid='loader' />);

    const box = screen.getByTestId('loader').parentElement as HTMLElement;
    // The button no longer grows for the loader, so a loader bigger than the
    // label has to scale down instead of spilling out
    expect(getComputedStyle(box).maxWidth).toBe('100%');
    expect(getComputedStyle(box.parentElement as HTMLElement).position).toBe(
      'absolute'
    );
  });

  it('treats a whitespace-only label as no content', () => {
    // The loader sizes the button, and the blank label neither holds the
    // button open nor takes space away from the loader
    const element = makeElement({
      text: ' ',
      text_formatted: [{ insert: ' ' }]
    });
    renderButton(element, <span data-testid='loader' />);

    const box = screen.getByTestId('loader').parentElement as HTMLElement;
    expect(box.parentElement?.tagName).toBe('BUTTON');
    expect(getComputedStyle(box).maxWidth).not.toBe('100%');

    const label = document.getElementById(`span-${element.id}`) as HTMLElement;
    expect(getComputedStyle(label.parentElement as HTMLElement).display).toBe(
      'none'
    );
  });

  it('does not clamp the loader when there is no content to preserve', () => {
    // Nothing is holding the button's size open, so the loader still sizes it
    renderButton(makeElement(), <span data-testid='loader' />);

    const box = screen.getByTestId('loader').parentElement as HTMLElement;
    const boxStyles = getComputedStyle(box);
    expect(boxStyles.maxWidth).not.toBe('100%');
    expect(boxStyles.position).not.toBe('absolute');
    // No wrapper between the button and the loader: an intermediate box is
    // sized by its own content, which collapses a percentage-sized loader
    expect(box.parentElement?.tagName).toBe('BUTTON');
  });
});
