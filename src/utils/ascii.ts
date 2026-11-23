const ASCII_TEXT_TYPES = new Set([
  'text_field',
  'text_area',
  'email',
  'url',
  'gmap_line_1',
  'gmap_line_2',
  'gmap_city',
  'gmap_state',
  'gmap_country',
  'gmap_zip',
  'dropdown',
  'dropdown_multi',
  'multiselect',
  'select',
  'button_group',
  'qr_scanner'
]);

export const isAsciiTextField = (type: string) => ASCII_TEXT_TYPES.has(type);

// These Latin letters and punctuation do not decompose into ASCII with NFKD.
const ASCII_EQUIVALENTS: Record<string, string> = {
  Æ: 'AE',
  æ: 'ae',
  Œ: 'OE',
  œ: 'oe',
  Ø: 'O',
  ø: 'o',
  Ł: 'L',
  ł: 'l',
  Đ: 'D',
  đ: 'd',
  Ð: 'D',
  ð: 'd',
  Þ: 'Th',
  þ: 'th',
  ß: 'ss',
  ẞ: 'SS',
  ı: 'i',
  '‘': "'",
  '’': "'",
  '‚': "'",
  '“': '"',
  '”': '"',
  '„': '"',
  '–': '-',
  '—': '-',
  '−': '-'
};

export function toAscii(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/[\u0080-\uFFFF]/g, (char) => ASCII_EQUIVALENTS[char] ?? '');
}

export function normalizeAsciiValue(value: any): any {
  if (typeof value === 'string') return toAscii(value);
  if (Array.isArray(value)) return value.map(normalizeAsciiValue);
  return value;
}

export function normalizeAsciiFieldValues<T extends Record<string, any>>(
  values: T,
  fields: Map<string, { type: string }>,
  enabled: boolean
): T {
  if (!enabled) return values;
  return Object.fromEntries(
    Object.entries(values).map(([key, value]) => [
      key,
      isAsciiTextField(fields.get(key)?.type ?? '')
        ? normalizeAsciiValue(value)
        : value
    ])
  ) as T;
}
