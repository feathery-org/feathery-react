import {
  clearNonCountryAddressFields,
  getChangedAddressServarIds,
  getRelatedAddressValues
} from './address';

const field = (type: string, key: string, id: string, position: number[]) => ({
  position,
  servar: { type, key, id, metadata: {} }
});

const line1 = field('gmap_line_1', 'address', 'servar-line-1', [0]);
const city = field('gmap_city', 'city', 'servar-city', [1]);
const state = field('gmap_state', 'state', 'servar-state', [2]);
const country = field('gmap_country', 'country', 'servar-country', [3]);

const activeStep = { servar_fields: [line1, city, state, country] };

const usAddress = {
  formatted_address: '1 Market St, San Francisco, CA 94105, USA',
  gmap_line_1: '1 Market St',
  gmap_city: 'San Francisco',
  gmap_state: 'California',
  gmap_state_short: 'CA',
  gmap_country: 'US'
};

describe('getChangedAddressServarIds', () => {
  // Autocompleting a US address after the country was set to one without
  // states has to report the country as changed, or a country-triggered
  // show/hide rule never runs (Aspire's hidden State field)
  it('reports every address servar whose value moved', () => {
    const fieldValues = {
      address: '',
      city: '',
      state: '',
      country: 'Netherlands'
    };
    const addrValues = getRelatedAddressValues(
      line1,
      activeStep,
      fieldValues,
      usAddress,
      null,
      line1.servar
    );

    expect(
      getChangedAddressServarIds(
        line1,
        activeStep,
        fieldValues,
        addrValues,
        null
      ).sort()
    ).toEqual([
      'servar-city',
      'servar-country',
      'servar-line-1',
      'servar-state'
    ]);
  });

  it('skips fields the autocomplete left at the same value', () => {
    const fieldValues = {
      address: '1 Market St',
      city: 'San Francisco',
      state: 'Nevada',
      country: 'United States'
    };
    const addrValues = getRelatedAddressValues(
      line1,
      activeStep,
      fieldValues,
      usAddress,
      null,
      line1.servar
    );

    // Only the state differs from what is already filled in, so a rule bound
    // to the country must not be woken up by a same-country autocomplete
    expect(
      getChangedAddressServarIds(
        line1,
        activeStep,
        fieldValues,
        addrValues,
        null
      )
    ).toEqual(['servar-state']);
  });

  it('reports nothing when the address is re-selected unchanged', () => {
    const fieldValues = {
      address: '1 Market St',
      city: 'San Francisco',
      state: 'California',
      country: 'United States'
    };
    const addrValues = getRelatedAddressValues(
      line1,
      activeStep,
      fieldValues,
      usAddress,
      null,
      line1.servar
    );

    expect(
      getChangedAddressServarIds(
        line1,
        activeStep,
        fieldValues,
        addrValues,
        null
      )
    ).toEqual([]);
  });

  it('compares only the written entry for repeated fields', () => {
    const fieldValues = {
      address: ['1 Market St', ''],
      city: ['San Francisco', ''],
      state: ['California', ''],
      country: ['United States', 'United States']
    };
    const addrValues = getRelatedAddressValues(
      line1,
      activeStep,
      fieldValues,
      usAddress,
      1,
      line1.servar
    );

    // Row 0 already holds these values but is untouched, so it must not count
    expect(
      getChangedAddressServarIds(
        line1,
        activeStep,
        fieldValues,
        addrValues,
        1
      ).sort()
    ).toEqual(['servar-city', 'servar-line-1', 'servar-state']);
  });
});

describe('clearNonCountryAddressFields', () => {
  it('returns the servars it actually cleared', () => {
    const fieldValues = {
      address: '1 Market St',
      city: 'San Francisco',
      state: '',
      country: 'United States'
    };
    const updateFieldValues = jest.fn();

    const cleared = clearNonCountryAddressFields(
      country,
      activeStep,
      fieldValues,
      updateFieldValues,
      null
    );

    expect(updateFieldValues).toHaveBeenCalledWith({
      address: '',
      city: '',
      state: ''
    });
    // State was already blank, so it did not change
    expect(cleared.sort()).toEqual(['servar-city', 'servar-line-1']);
  });
});
