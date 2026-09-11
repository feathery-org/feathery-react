/* eslint-disable no-restricted-globals -- Tests exercise DOM portal inheritance. */
import { render, act } from '@testing-library/react';
import { useRef } from 'react';
import { TABLE_CLASS } from '../classNames';
import { getTablePortalStyles, useTablePortalStyles } from '../portalStyles';

function makeTable(color: string) {
  const table = document.createElement('div');
  table.className = TABLE_CLASS.container;
  table.style.setProperty('--feathery-table-controls-background-color', color);
  table.style.setProperty('--unrelated-style', 'private');
  const anchor = document.createElement('button');
  table.appendChild(anchor);
  document.body.appendChild(table);
  return { table, anchor };
}

function Portal({ anchor }: { anchor: HTMLElement | null }) {
  const ref = useRef<HTMLDivElement>(null);
  useTablePortalStyles(anchor, ref);
  return <div data-testid='portal' ref={ref} />;
}

afterEach(() => {
  document
    .querySelectorAll(`.${TABLE_CLASS.container}`)
    .forEach((el) => el.remove());
});

test('copies only the triggering table custom properties', () => {
  const first = makeTable('red');
  const second = makeTable('blue');
  expect(getTablePortalStyles(first.anchor)).toEqual({
    '--feathery-table-controls-background-color': 'red'
  });
  expect(getTablePortalStyles(second.anchor)).toEqual({
    '--feathery-table-controls-background-color': 'blue'
  });
  expect(getTablePortalStyles(null)).toEqual({});
  expect(getTablePortalStyles(document.body)).toEqual({});
});

test('updates open portals on rerender and resize, removing stale properties', () => {
  const { table, anchor } = makeTable('red');
  const { getByTestId, rerender, unmount } = render(<Portal anchor={anchor} />);
  const style = getByTestId('portal').style;
  expect(style.getPropertyValue('--feathery-table-controls-background-color')).toBe(
    'red'
  );
  table.style.setProperty('--feathery-table-controls-background-color', 'blue');
  act(() => window.dispatchEvent(new Event('resize')));
  expect(style.getPropertyValue('--feathery-table-controls-background-color')).toBe(
    'blue'
  );
  table.style.removeProperty('--feathery-table-controls-background-color');
  rerender(<Portal anchor={anchor} />);
  expect(style.getPropertyValue('--feathery-table-controls-background-color')).toBe('');
  unmount();
});
