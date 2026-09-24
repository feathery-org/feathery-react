import React from 'react';
import { act, render, screen, waitFor } from '@testing-library/react';
import { useSpreadsheetGeometry } from '../spreadsheet/useSpreadsheetGeometry';

function GeometryProbe({ revision = 0 }: { revision?: number }) {
  const ref = React.useRef<HTMLDivElement>(null);
  const geometry = useSpreadsheetGeometry(ref);
  return (
    <div ref={ref} data-testid='geometry' data-revision={revision}>
      {geometry.rowHeight},{geometry.headerHeight},{geometry.cellFont.family}
    </div>
  );
}

describe('responsive spreadsheet geometry', () => {
  let variables: Record<string, string>;
  let computedStyle: jest.SpyInstance;
  beforeEach(() => {
    variables = {};
    computedStyle = jest.spyOn(window, 'getComputedStyle').mockImplementation(
      () =>
        ({
          getPropertyValue: (name: string) => variables[name] ?? ''
        } as CSSStyleDeclaration)
    );
  });
  afterEach(() => computedStyle.mockRestore());

  test('synchronizes builder stylesheet edits after a render', () => {
    const { rerender } = render(<GeometryProbe />);
    expect(screen.getByTestId('geometry').textContent).toMatch(/^32,34,/);
    variables = {
      '--feathery-table-row-height': '60px',
      '--feathery-table-header-height': '48px',
      '--feathery-table-font-family': 'Georgia, serif'
    };
    rerender(<GeometryProbe revision={1} />);
    expect(screen.getByTestId('geometry')).toHaveTextContent(
      '60,48,Georgia, serif'
    );
  });

  test('synchronizes responsive changes and ancestor class edits without a render', async () => {
    const { container } = render(<GeometryProbe />);
    variables = { '--feathery-table-row-height': '44px' };
    act(() => {
      window.dispatchEvent(new Event('resize'));
    });
    expect(screen.getByTestId('geometry').textContent).toMatch(/^44,34,/);
    variables = { '--feathery-table-header-height': '56px' };
    container.className = 'mobile-preview';
    await waitFor(() =>
      expect(screen.getByTestId('geometry').textContent).toMatch(/^32,56,/)
    );
  });
});
