import ResponsiveStyles from '../../../styles';
import { applyTableAppearance } from '../appearance';

function appearance(styles: Record<string, unknown>, mobile_styles = {}) {
  const responsive = new ResponsiveStyles(
    { styles, mobile_styles },
    ['container'],
    true
  );
  applyTableAppearance(responsive);
  return responsive.getTarget('container');
}

describe('table appearance', () => {
  it('preserves legacy defaults when table styles are absent', () => {
    expect(appearance({ font_size: 40, background_color: 'FF0000FF' })).toEqual(
      {
        '@media (max-width: 478px)': {}
      }
    );
  });

  it('converts persisted colors and lengths while preserving zero and transparency', () => {
    expect(
      appearance({
        table_header_background_color: '12345680',
        table_grid_horizontal_color: 'E5E7EBFF',
        table_border_width: 0,
        table_row_background_color: 'transparent',
        table_cell_padding_horizontal: '12'
      })
    ).toMatchObject({
      '--feathery-table-header-background-color': '#12345680',
      '--feathery-table-grid-horizontal-color': '#E5E7EBFF',
      '--feathery-table-border-width': '0px',
      '--feathery-table-row-background-color': 'transparent',
      '--feathery-table-cell-padding-horizontal': '12px'
    });
  });

  it('keeps mobile overrides independent from desktop values', () => {
    expect(
      appearance({ table_font_size: 18 }, { table_font_size: 12 })
    ).toMatchObject({
      '--feathery-table-font-size': '18px',
      '@media (max-width: 478px)': { '--feathery-table-font-size': '12px' }
    });
  });

  it('ignores invalid values and clamps dimensions to safe bounds', () => {
    expect(
      appearance({
        table_font_size: 'nope',
        table_row_height: -4,
        table_header_height: 99999,
        table_grid_vertical_width: 99,
        table_border_color: 'red;display:none',
        table_font_weight: 600,
        table_cell_text_align: 'right'
      })
    ).toEqual({
      '--feathery-table-row-height': '0px',
      '--feathery-table-header-height': '1000px',
      '--feathery-table-grid-vertical-width': '20px',
      '--feathery-table-font-weight': 600,
      '--feathery-table-cell-text-align': 'right',
      '@media (max-width: 478px)': {}
    });
  });

  it('quotes font names without changing generic families', () => {
    expect(appearance({ table_font_family: 'Open Sans' })).toMatchObject({
      '--feathery-table-font-family': '"Open Sans", sans-serif'
    });
    expect(appearance({ table_font_family: 'serif' })).toMatchObject({
      '--feathery-table-font-family': 'serif'
    });
  });
});
