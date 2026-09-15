import React from 'react';
import { render } from '@testing-library/react';
import Placeholder from '../Placeholder';

// A pinned label is several responsive targets rendered as one element, and
// each target carries its own @media block. Spreading getTarget() results into
// one css object lets the last block replace the ones before it, which dropped
// the resting label's mobile lineHeight -- the line box the pinned label's
// reserve is computed from -- so a 28px mobile font reserved 33px for a label
// that stayed 16px tall. getTargets() merges the blocks instead.
//
// jsdom does not materialise emotion's @media rules, so this pins the API the
// component reaches for; 'merging the placeholder targets for a pinned label'
// in fields/tests/innerPadding.spec.ts pins what that API merges.
function renderWith(props: { value?: string; inputFocused?: boolean }) {
  const calls: string[][] = [];
  const responsiveStyles = {
    getTargets: (...names: string[]) => {
      calls.push(names.filter(Boolean));
      return {};
    },
    getTarget: (name: string) => {
      throw new Error(
        `Placeholder spread getTarget('${name}'): two spread targets clobber each other's @media block, use getTargets`
      );
    }
  };
  render(
    <Placeholder
      element={{ properties: { placeholder: 'Untouched' } }}
      responsiveStyles={responsiveStyles}
      {...props}
    />
  );
  return calls;
}

describe('Placeholder', () => {
  it('layers the pinned target onto the resting one through getTargets', () => {
    const calls = renderWith({ value: 'x' });
    expect(calls).toContainEqual(['placeholder', 'placeholderFocus']);
  });

  it('layers focus and active the same way when the input is focused', () => {
    const calls = renderWith({ value: 'x', inputFocused: true });
    expect(calls).toContainEqual([
      'placeholder',
      'placeholderFocus',
      'placeholderFocus',
      'placeholderActive'
    ]);
    // The `:focus ~ &` rule is built from the same merge.
    expect(calls).toContainEqual(['placeholderFocus', 'placeholderActive']);
  });

  it('renders the resting label alone when nothing is pinned or focused', () => {
    const calls = renderWith({});
    expect(calls).toContainEqual(['placeholder']);
  });
});
