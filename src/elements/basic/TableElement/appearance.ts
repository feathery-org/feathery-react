import ResponsiveStyles from '../../styles';
import { getFontFallback, isGenericFamily } from '../../../utils/fonts';

const colorProperties = [
  'background',
  'border',
  'font',
  'header_background',
  'header_font',
  'grid_horizontal',
  'grid_vertical',
  'row_background',
  'alternate_row_background',
  'row_hover_background',
  'controls_background',
  'controls_font',
  'controls_border',
  'controls_hover_background',
  'selected_background',
  'selected_font',
  'accent',
  'error_background',
  'error_font',
  'warning_background',
  'warning_font',
  'editor_background',
  'editor_font'
];

const lengthProperties: Record<string, number> = {
  border_width: 20,
  grid_horizontal_width: 20,
  grid_vertical_width: 20,
  border_radius: 200,
  font_size: 200,
  header_font_size: 200,
  controls_font_size: 200,
  row_height: 1000,
  header_height: 1000,
  cell_padding_horizontal: 200,
  cell_padding_vertical: 200,
  controls_border_radius: 200
};

export const tableVariable = (name: string, fallback: string | number) =>
  `var(--feathery-table-${name.replace(/_/g, '-')}, ${fallback})`;

function color(value: unknown) {
  if (typeof value !== 'string') return undefined;
  if (value === 'transparent') return value;
  return /^#?(?:[\da-f]{3}|[\da-f]{4}|[\da-f]{6}|[\da-f]{8})$/i.test(value)
    ? `#${value.replace(/^#/, '')}`
    : undefined;
}

function number(value: unknown, max: number) {
  if (value === '' || value === null || value === undefined) return undefined;
  if (typeof value !== 'string' && typeof value !== 'number') return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed)
    ? Math.min(max, Math.max(0, parsed))
    : undefined;
}

export function applyTableAppearance(styles: ResponsiveStyles) {
  const apply = (name: string, convert: (value: unknown) => unknown) => {
    styles.apply('container', `table_${name}`, (value: unknown) => {
      const converted = convert(value);
      return converted === undefined
        ? {}
        : { [`--feathery-table-${name.replace(/_/g, '-')}`]: converted };
    });
  };
  colorProperties.forEach((name) => apply(`${name}_color`, color));
  Object.entries(lengthProperties).forEach(([name, max]) =>
    apply(name, (value) => {
      const length = number(value, max);
      return length === undefined ? undefined : `${length}px`;
    })
  );
  ['font_weight', 'header_font_weight', 'controls_font_weight'].forEach(
    (name) => apply(name, (value) => number(value, 1000))
  );
  ['cell_text_align', 'header_text_align'].forEach((name) =>
    apply(name, (value) =>
      ['left', 'center', 'right', 'start', 'end'].includes(value as string)
        ? value
        : undefined
    )
  );
  apply('font_family', (value) => {
    if (typeof value !== 'string' || !value.trim()) return undefined;
    return isGenericFamily(value)
      ? value
      : `${JSON.stringify(value)}, ${getFontFallback(value) || 'sans-serif'}`;
  });
}
