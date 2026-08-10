import { render } from '@testing-library/react';

import { featheryDoc } from '../utils/browser';
import { BusyWash } from './ToolStatus';

// Emotion writes real rules into the document, so these read the styles a
// browser would actually apply - including the ones jsdom's computed style
// never resolves, like anything behind a media query
const styleRules = (): CSSRule[] =>
  Array.from(featheryDoc().styleSheets).flatMap((sheet: any) =>
    Array.from((sheet as CSSStyleSheet).cssRules)
  );

const matches = (rule: CSSRule, el: Element): boolean =>
  rule instanceof CSSStyleRule && el.matches(rule.selectorText);

const ruleFor = (el: Element): CSSStyleRule => {
  const rule = styleRules().find((r) => matches(r, el));
  if (!rule) throw new Error('no style rule found for element');
  return rule as CSSStyleRule;
};

const prop = (el: Element, name: string): string =>
  ruleFor(el).style.getPropertyValue(name);

const reducedMotionRulesFor = (el: Element): CSSStyleRule[] =>
  styleRules()
    .filter(
      (r): r is CSSMediaRule =>
        r instanceof CSSMediaRule &&
        r.media.mediaText.includes('prefers-reduced-motion')
    )
    .flatMap((media) => Array.from(media.cssRules))
    .filter((r): r is CSSStyleRule => matches(r, el));

const renderWash = () => {
  const { container } = render(<BusyWash />);
  const wash = container.firstElementChild as HTMLElement;
  return { wash, shimmer: wash.firstElementChild as HTMLElement };
};

describe('assistant busy wash', () => {
  // Dimming is a signal, not a lock: an overlay that swallowed events would
  // stop the transcript scrolling and the rail inside it being clicked
  it('never takes pointer events', () => {
    const { wash, shimmer } = renderWash();

    expect(wash).toHaveStyle({ pointerEvents: 'none' });
    // pointer-events is inherited, so the shimmer inside cannot take them
    // either - and it must not declare its own value that reinstates them
    expect(prop(shimmer, 'pointer-events')).toBe('');
  });

  it('covers the region rather than any of the content in it', () => {
    const { wash } = renderWash();

    // Absolutely positioned against the region, so it holds still while the
    // transcript scrolls under it and cannot add scrollbars of its own
    expect(wash).toHaveStyle({ position: 'absolute', overflow: 'hidden' });
    expect(prop(wash, 'inset')).toBe('0');
  });

  it('drops the travelling shimmer under prefers-reduced-motion', () => {
    const { wash, shimmer } = renderWash();

    expect(
      reducedMotionRulesFor(shimmer).some(
        (r) =>
          r.style.getPropertyValue('display') === 'none' ||
          r.style.getPropertyValue('animation') === 'none'
      )
    ).toBe(true);
    // The dim itself stays - it is what carries the signal once the motion is
    // gone, so nothing about the wash may be behind that query
    expect(reducedMotionRulesFor(wash)).toHaveLength(0);
  });

  it('holds itself back so a turn that ends quickly cannot flash it', () => {
    const { wash } = renderWash();
    const animation = prop(wash, 'animation');

    // Fill mode `both` keeps it fully transparent for the whole delay, so a
    // sub-200ms turn shows nothing at all rather than a blink
    expect(animation).toContain('200ms');
    expect(animation).toContain('both');
  });

  // A uniform multiply barely moves a contrast ratio, so the live indicator
  // stays readable without the strip needing a lighter wash of its own - and a
  // lighter strip would draw a pale band with an edge across the panel
  it('dims the whole region evenly, at 10%', () => {
    const { wash } = renderWash();
    const color = prop(wash, 'background-color');

    expect(prop(wash, 'background-image')).toBe('');
    expect(color.replace(/\s/g, '')).toBe('rgba(0,0,0,0.1)');
  });
});
