import { stateFieldIsOptionless } from '../addressState';

const field = (
  type: string,
  key: string,
  position: number[],
  metadata = {}
) => ({
  position,
  servar: { type, key, id: `servar-${key}`, metadata }
});

const country = field('gmap_country', 'country', [3]);
const stepWith = (state: any) => ({ servar_fields: [state, country] });

describe('stateFieldIsOptionless', () => {
  const state = field('gmap_state', 'state', [2]);

  it('is true only when the country has no states', () => {
    expect(
      stateFieldIsOptionless(state, stepWith(state), { country: 'Netherlands' })
    ).toBe(true);
    expect(
      stateFieldIsOptionless(state, stepWith(state), { country: 'Canada' })
    ).toBe(false);
  });

  // Fields predating the setting have no key, and draft step blobs carry their
  // own servar snapshots, so absent has to mean enabled
  it('applies when the setting is absent, not when explicitly off', () => {
    const off = field('gmap_state', 'state', [2], {
      disable_without_states: false
    });
    expect(
      stateFieldIsOptionless(state, stepWith(state), { country: 'Netherlands' })
    ).toBe(true);
    expect(
      stateFieldIsOptionless(off, stepWith(off), { country: 'Netherlands' })
    ).toBe(false);
  });

  it('ignores non-state fields', () => {
    expect(stateFieldIsOptionless(country, stepWith(state), {})).toBe(false);
  });

  it('follows each row of a repeating country', () => {
    const values = { country: ['United States', 'Netherlands'] };
    expect(stateFieldIsOptionless(state, stepWith(state), values, 0)).toBe(
      false
    );
    expect(stateFieldIsOptionless(state, stepWith(state), values, 1)).toBe(
      true
    );
  });
});
