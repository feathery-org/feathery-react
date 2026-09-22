import countryData from '../elements/components/data/countries';
import { stringifyWithNull } from './primitives';

// Field types whose stored value is an option key that may render as a label.
// matrix is excluded: its options belong to individual questions rather than
// the field, so a text variable pointed at the field key has no single option
// list to resolve against.
const OPTION_FIELD_TYPES = new Set([
  'dropdown',
  'dropdown_multi',
  'multiselect',
  'select',
  'button_group'
]);

type LabelMap = Map<string, string>;

type OptionLabelEntry = {
  // Option value -> label for the field's default option list.
  byValue: LabelMap;
  // Repeating fields can override their options per repeat index; each slot
  // mirrors servar.metadata.repeat_options[i], and an override replaces the
  // default list rather than extending it.
  byRepeatIndex?: (LabelMap | undefined)[];
};

/**
 * Option fields whose values render as labels in text variables, keyed by field
 * key.
 *
 * Derived from the form schema rather than captured when a value is set:
 * options change far less often than values do, so keying on options means no
 * value write path can leave this stale. Holds plain maps rather than the
 * servar, since Form deep-clones steps whenever options change and a held
 * servar reference would go stale.
 */
const optionLabels: Record<string, OptionLabelEntry> = {};

/**
 * Labels for options a field fetched at runtime, keyed by field key.
 *
 * Kept apart from the schema-derived registry rather than merged into it: a
 * Salesforce picklist never reaches servar.metadata, so a later schema load —
 * a language switch, say — would re-register the field from its static options
 * and drop the fetched labels.
 */
const dynamicOptionLabels: Record<string, LabelMap> = {};

/**
 * A label that matches its own value is no label at all — the field components
 * fall back to rendering the value in that case, and leaving it out of the map
 * keeps text variables on the same raw-value path.
 */
function addLabel(map: LabelMap, value: any, label: any) {
  const val = stringifyWithNull(value);
  if (label && label !== val) map.set(val, stringifyWithNull(label));
}

// Parallel options/option_labels arrays, as the builder stores them.
function buildLabelMap(options: any[], labels: any[]) {
  const map: LabelMap = new Map();
  options.forEach((option, index) => addLabel(map, option, labels[index]));
  return map;
}

// Option lists that carry their own labels: repeat_options entries, which
// arrive either as {value, label} objects or as bare values, and the options a
// field fetches at runtime.
function buildObjectLabelMap(options: any[]) {
  const map: LabelMap = new Map();
  options.forEach((option: any) =>
    addLabel(map, option?.value ?? option, option?.label ?? option)
  );
  return map;
}

/**
 * gmap_country stores a country code when store_abbreviation is on, so its
 * label comes from the country list rather than option_labels. The element's
 * translate map overrides those names for its own dropdown, so honor it here
 * too.
 *
 * gmap_state is deliberately not registered: its option list depends on the
 * current value of a controlling country field, which isn't knowable from the
 * schema alone.
 */
function buildCountryLabelMap(servar: any, properties: any) {
  const translate = properties?.translate ?? {};
  const short = servar.metadata?.store_abbreviation;
  const map: LabelMap = new Map();
  countryData.forEach(({ countryCode, countryName }) =>
    addLabel(
      map,
      short ? countryCode : countryName,
      translate[countryCode] || countryName
    )
  );
  return map;
}

/**
 * Record the labels one field's options render as. Safe to call repeatedly —
 * every call rebuilds that key from the servar it was handed, so a schema
 * reload in another language or a dynamic option update lands here intact.
 */
export function registerOptionLabels(servar: any, properties?: any) {
  if (!servar?.key) return;
  const meta = servar.metadata ?? {};

  let byValue: LabelMap;
  if (servar.type === 'gmap_country')
    byValue = buildCountryLabelMap(servar, properties);
  else if (OPTION_FIELD_TYPES.has(servar.type))
    byValue = buildLabelMap(meta.options ?? [], meta.option_labels ?? []);
else {
    delete optionLabels[servar.key];
    delete dynamicOptionLabels[servar.key];
    return;
  }

  const byRepeatIndex =
    servar.repeated && Array.isArray(meta.repeat_options)
      ? meta.repeat_options.map((options: any) =>
          Array.isArray(options) ? buildObjectLabelMap(options) : undefined
        )
      : undefined;

  // Drop rather than skip when nothing carries a label, so clearing labels in
  // the builder releases a key an earlier schema load registered.
  if (!byValue.size && !byRepeatIndex?.some((map: any) => map?.size))
    delete optionLabels[servar.key];
  else optionLabels[servar.key] = { byValue, byRepeatIndex };
}

/**
 * Record the labels a field's fetched options render as, for option sources
 * that never reach servar.metadata. Those options replace the schema's in the
 * field components, so they take precedence here too.
 *
 * Passing an empty list releases the key, which is how a failed fetch or a
 * field that stopped syncing falls back to its schema labels.
 */
export function registerDynamicOptionLabels(key: string, options: any[]) {
  if (!key) return;
  const map = buildObjectLabelMap(options ?? []);
  if (map.size) dynamicOptionLabels[key] = map;
  else delete dynamicOptionLabels[key];
}

/**
 * The label a field's option renders as, or undefined when the value should
 * render as itself.
 *
 * `repeat` is the repeat index the text variable resolved to. It selects
 * per-index options only for a repeating field: for a multiselect the value
 * array holds selections rather than repeat entries, and those fields register
 * no per-index options at all.
 */
export function getOptionLabel(key: string, value: any, repeat?: number) {
  const dynamic = dynamicOptionLabels[key];
  const entry = optionLabels[key];
  if (!dynamic && !entry) return undefined;

  const repeatMap =
    repeat === undefined ? undefined : entry?.byRepeatIndex?.[repeat];
  // Fetched options stand in for the whole list, per-index overrides included.
  const map = dynamic ?? repeatMap ?? entry?.byValue;
  if (!map) return undefined;

  // multiselect stores its selections as an array; label each selection
  // rather than stringifying the array itself.
  if (Array.isArray(value))
    return value
      .map(
        (item) => map.get(stringifyWithNull(item)) ?? stringifyWithNull(item)
      )
      .join(',');

  return map.get(stringifyWithNull(value));
}

// Field definitions don't belong to a submitter, so this isn't reset with the
// user ID. Exported for tests, which need a clean registry per case.
export function clearOptionLabels() {
  Object.keys(optionLabels).forEach((key) => delete optionLabels[key]);
  Object.keys(dynamicOptionLabels).forEach(
    (key) => delete dynamicOptionLabels[key]
  );
}
