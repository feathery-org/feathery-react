import { findCountryByID } from '../../../../elements/components/data/countries';
import { justInsert } from '../../../../utils/array';
import { isObjectEmpty } from '../../../../utils/primitives';
import { pickCloserElement } from './utils';

const ADDRESS_FIELD_TYPES_MAP = new Set([
  'gmap_line_1',
  'gmap_line_2',
  'gmap_city',
  'gmap_state',
  'gmap_country',
  'gmap_zip'
]);

// Returns list of closest address fields
export const getRelatedAddressFields = (element: any, activeStep: any) => {
  const addrFields: any = {};

  activeStep.servar_fields.forEach((field: any) => {
    const servar = field.servar;
    if (ADDRESS_FIELD_TYPES_MAP.has(servar.type)) {
      addrFields[servar.type] = pickCloserElement(
        element,
        addrFields[servar.type],
        field
      );
    }
  });

  return addrFields;
};

// Compares a field's old and new value, accounting for repeated fields where
// only the entry at `index` is being written.
export const addressValueChanged = (
  prevVal: any,
  newVal: any,
  index: number | null
) => {
  if (index === null) return prevVal !== newVal;
  return (prevVal ?? [])[index] !== (newVal ?? [])[index];
};

// Clears address fields when country is changed.
// Returns the servar IDs that were actually cleared so the caller can report
// them as part of the change event.
export const clearNonCountryAddressFields = (
  countryElement: any,
  activeStep: any,
  fieldValues: any,
  updateFieldValues: any,
  index: any
) => {
  const addrFields: any = getRelatedAddressFields(countryElement, activeStep);

  const clearedValues: any = {};
  const clearedServarIds: string[] = [];
  Object.entries(addrFields).forEach(([fieldType, field]: any) => {
    // skip country fields
    if (fieldType === 'gmap_country') return;

    const servar = field.servar;
    const emptyVal = '';

    clearedValues[servar.key] =
      index === null
        ? emptyVal
        : justInsert(fieldValues[servar.key] || [], emptyVal, index);
    if (
      addressValueChanged(
        fieldValues[servar.key],
        clearedValues[servar.key],
        index
      )
    )
      clearedServarIds.push(servar.id);
  });

  if (!isObjectEmpty(clearedValues)) {
    updateFieldValues(clearedValues);
  }

  return clearedServarIds;
};

// Calculates the new field values for address fields when address is autocompleted
export const getRelatedAddressValues = (
  addressElement: any,
  activeStep: any,
  fieldValues: any,
  address: any,
  index: any,
  servar: any
) => {
  const addrValues: Record<string, any> = {};
  if (addressElement.servar.metadata.save_address === 'all_line_1') {
    const val = address.formatted_address;
    addrValues[addressElement.servar.key] =
      index === null
        ? val
        : justInsert(fieldValues[servar.key] || [], val, index);
  } else {
    const addrFields: Record<string, any> = getRelatedAddressFields(
      addressElement,
      activeStep
    );
    Object.entries(addrFields).forEach(([, field]) => {
      const servar = field.servar;
      let val;
      if (servar.type === 'gmap_state' && servar.metadata.store_abbreviation)
        val = address.gmap_state_short;
      else if (
        servar.type === 'gmap_country' &&
        !servar.metadata.store_abbreviation
      ) {
        const countryObject = findCountryByID(address.gmap_country);
        val = countryObject ? countryObject.countryName : address.gmap_country;
      } else val = address[servar.type];
      val = val ?? '';
      addrValues[servar.key] =
        index === null
          ? val
          : justInsert(fieldValues[servar.key] || [], val, index);
    });
  }

  return addrValues;
};

// An address autocomplete writes several fields at once but only some move.
// Returns the servar IDs whose value changed, so change rules bound to any of
// them still run even though the user only touched the address line.
export const getChangedAddressServarIds = (
  addressElement: any,
  activeStep: any,
  fieldValues: any,
  addrValues: Record<string, any>,
  index: any
) => {
  const servarIdsByKey: Record<string, string> = {};
  Object.values(
    getRelatedAddressFields(addressElement, activeStep) as Record<string, any>
  ).forEach((field: any) => {
    servarIdsByKey[field.servar.key] = field.servar.id;
  });

  return Object.entries(addrValues)
    .filter(
      ([key, val]) =>
        servarIdsByKey[key] && addressValueChanged(fieldValues[key], val, index)
    )
    .map(([key]) => servarIdsByKey[key]);
};
