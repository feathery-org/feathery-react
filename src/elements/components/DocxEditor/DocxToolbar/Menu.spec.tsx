import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { featheryWindow } from '../../../../utils/browser';
import Menu from './Menu';

// jsdom reports every rect as zeros, so an 'end'-aligned panel measures as
// touching the viewport's left edge — exactly the narrow-viewport cutoff the
// clamp exists for. Override per test to simulate real geometry.
function mockPanelRect(rect: Partial<DOMRect>) {
  return jest
    .spyOn(HTMLElement.prototype, 'getBoundingClientRect')
    .mockImplementation(function (this: HTMLElement) {
      const base = {
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        width: 0,
        height: 0
      };
      const r = this.hasAttribute('data-docx-menu')
        ? { ...base, ...rect }
        : base;
      return { ...r, x: r.left, y: r.top, toJSON: () => r } as DOMRect;
    });
}

function renderMenu(align: 'start' | 'end' = 'end') {
  return render(
    <Menu
      align={align}
      trigger={({ toggle }) => (
        <button type='button' onClick={toggle} title='open menu'>
          open
        </button>
      )}
    >
      {() => <div>panel content</div>}
    </Menu>
  );
}

afterEach(() => jest.restoreAllMocks());

it('keeps a parent menu open while a nested portal takes focus', () => {
  const select = jest.fn();
  render(
    <>
      <Menu
        trigger={({ toggle }) => <button onClick={toggle}>More tools</button>}
      >
        {() => (
          <Menu
            trigger={({ toggle }) => <button onClick={toggle}>Fonts</button>}
          >
            {() => (
              <>
                <input aria-label='Search fonts' autoFocus />
                <button onClick={select}>Inter</button>
              </>
            )}
          </Menu>
        )}
      </Menu>
      <button>Outside toolbar</button>
    </>
  );
  fireEvent.click(screen.getByText('More tools'));
  fireEvent.click(screen.getByText('Fonts'));
  expect(screen.getByLabelText('Search fonts')).toHaveFocus();
  act(() => screen.getByText('Inter').focus());
  fireEvent.click(screen.getByText('Inter'));
  expect(select).toHaveBeenCalledTimes(1);
  act(() => screen.getByText('Outside toolbar').focus());
  expect(screen.queryByLabelText('Search fonts')).toBeNull();
});

describe('Menu viewport clamping', () => {
  it('shifts a panel that would overflow the left viewport edge back on-screen', () => {
    // Panel extends 150px past the left edge (end-aligned near a narrow
    // viewport's left side — the More-dropdown cutoff).
    mockPanelRect({ left: -150, right: 70, width: 220 });
    renderMenu('end');
    fireEvent.click(screen.getByTitle('open menu'));

    const panel = screen.getByText('panel content')
      .parentElement as HTMLElement;
    // pos.left is 0 (trigger rect is zeros); the clamp adds 8 - (-150).
    expect(panel.style.left).toBe('158px');
  });

  it('shifts a panel that would overflow the right viewport edge', () => {
    const vw = featheryWindow().innerWidth;
    mockPanelRect({ left: vw - 100, right: vw + 120, width: 220 });
    renderMenu('start');
    fireEvent.click(screen.getByTitle('open menu'));

    const panel = screen.getByText('panel content')
      .parentElement as HTMLElement;
    // Shift = (vw - 8) - (vw + 120) = -128.
    expect(panel.style.left).toBe('-128px');
  });

  it('leaves a fully-visible panel where its anchor put it', () => {
    mockPanelRect({ left: 100, right: 320, width: 220 });
    renderMenu('start');
    fireEvent.click(screen.getByTitle('open menu'));

    const panel = screen.getByText('panel content')
      .parentElement as HTMLElement;
    expect(panel.style.left).toBe('0px');
  });
});
