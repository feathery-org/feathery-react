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

// repeat_options entries arrive either as {value, label} objects or as bare
// values, matching what DropdownField renders from.
function buildRepeatLabelMap(options: any[]) {
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
  else return;

  const byRepeatIndex =
    servar.repeated && Array.isArray(meta.repeat_options)
      ? meta.repeat_options.map((options: any) =>
          Array.isArray(options) ? buildRepeatLabelMap(options) : undefined
        )
      : undefined;

  // Drop rather than skip when nothing carries a label, so clearing labels in
  // the builder releases a key an earlier schema load registered.
  if (!byValue.size && !byRepeatIndex?.some((map: any) => map?.size))
    delete optionLabels[servar.key];
  else optionLabels[servar.key] = { byValue, byRepeatIndex };
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
  const entry = optionLabels[key];
  if (!entry) return undefined;

  const val = stringifyWithNull(value);
  const repeatMap =
    repeat === undefined ? undefined : entry.byRepeatIndex?.[repeat];
  return repeatMap ? repeatMap.get(val) : entry.byValue.get(val);
}

// Field definitions don't belong to a submitter, so this isn't reset with the
// user ID. Exported for tests, which need a clean registry per case.
export function clearOptionLabels() {
  Object.keys(optionLabels).forEach((key) => delete optionLabels[key]);
}
