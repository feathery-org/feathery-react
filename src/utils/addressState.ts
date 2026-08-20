import { findCountryByID } from '../elements/components/data/countries';
import { stateMap } from '../elements/components/data/states';
import { numMatchingItems } from './primitives';

// Leaf module: hideAndRepeats needs these, and Element's address utils reach
// back into fieldHelperFunctions, which would close an import cycle.

// Resolves the ISO country code driving a state field, from the closest country
// field on the step. Returns '' when there is no country field or no value yet.
export const getControllingCountryCode = (
  stateElement: any,
  activeStep: any,
  fieldValues: any,
  repeatIndex?: number
) => {
  const field = activeStep.servar_fields
    .filter((field: any) => field.servar.type === 'gmap_country')
    .sort((a: any, b: any) => {
      // Assume the closest country field to
      // the state field is controlling it
      const aMatching = numMatchingItems(stateElement.position, a.position);
      const bMatching = numMatchingItems(stateElement.position, b.position);
      if (aMatching < bMatching) return 1;
      if (aMatching > bMatching) return -1;
      const aNext = a.position[aMatching];
      const bNext = b.position[bMatching];
      const elNext = stateElement.position[aMatching];
      return Math.abs(elNext - aNext) > Math.abs(elNext - bNext) ? 1 : -1;
    })[0];
  if (!field) return '';

  let value = fieldValues[field.servar.key] as string | string[];
  // A repeating country pairs with the state field's row; fall back to the
  // first entry when the state isn't repeated or the row has no country yet.
  if (Array.isArray(value)) value = value[repeatIndex ?? 0] || value[0];
  if (!value) return '';

  return field.servar.metadata.store_abbreviation
    ? value
    : findCountryByID(value, 'name')?.countryCode ?? '';
};

// A state field whose country has no states in our data has nothing to offer -
// an empty dropdown, which a required field can never satisfy. Resolves the
// country the way DropdownField does, so the two never disagree.
export const stateFieldHasNoOptions = (
  stateElement: any,
  activeStep: any,
  fieldValues: any,
  repeatIndex?: number
) => {
  const metadata = stateElement.servar.metadata ?? {};
  // Salesforce-synced fields are populated by the integration, not our data
  if (metadata.salesforce_sync) return false;

  const code = (
    getControllingCountryCode(
      stateElement,
      activeStep,
      fieldValues,
      repeatIndex
    ) ||
    metadata.default_country ||
    'us'
  ).toLowerCase();
  return !stateMap[code]?.length;
};
