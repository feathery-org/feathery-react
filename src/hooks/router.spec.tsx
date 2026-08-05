import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { RouterProvider, useLocation, useNavigate } from './router';

jest.mock('../utils/browser', () => {
  let popStateHandler: ((event: PopStateEvent) => void) | null = null;
  const location = {
    href: 'https://example.com/first',
    pathname: '/first'
  };
  const history: any = {
    state: null,
    go: jest.fn()
  };
  history.pushState = jest.fn((state: any, _title: string, to: string) => {
    history.state = state;
    location.pathname = to;
  });
  history.replaceState = jest.fn((state: any, _title: string, to: string) => {
    history.state = state;
    if (to.startsWith('/')) location.pathname = to;
  });

  const state = {
    history,
    location,
    addEventListener: jest.fn((type: string, handler: any) => {
      if (type === 'popstate') popStateHandler = handler;
    }),
    removeEventListener: jest.fn((type: string, handler: any) => {
      if (type === 'popstate' && popStateHandler === handler)
        popStateHandler = null;
    }),
    emitPop: (nextState: any, pathname: string) => {
      history.state = nextState;
      location.pathname = pathname;
      popStateHandler?.({ state: nextState } as PopStateEvent);
    },
    reset: () => {
      popStateHandler = null;
      history.state = null;
      history.go.mockReset();
      history.pushState.mockClear();
      history.replaceState.mockClear();
      location.href = 'https://example.com/first';
      location.pathname = '/first';
      state.addEventListener.mockClear();
      state.removeEventListener.mockClear();
    }
  };

  return {
    featheryWindow: () => ({
      addEventListener: state.addEventListener,
      removeEventListener: state.removeEventListener,
      history,
      location
    }),
    _spies: state
  };
});

const BrowserMod: any = jest.requireMock('../utils/browser');

function RouterHarness() {
  const location = useLocation();
  const navigate = useNavigate();
  return (
    <>
      <span data-testid='path'>{location.pathname}</span>
      <button type='button' onClick={() => navigate('/second')}>
        Next
      </button>
    </>
  );
}

const renderRouter = (confirmPopNavigation = jest.fn(() => true)) => {
  render(
    <RouterProvider
      navigationId='form-a'
      confirmPopNavigation={confirmPopNavigation}
    >
      <RouterHarness />
    </RouterProvider>
  );
  return confirmPopNavigation;
};

beforeEach(() => BrowserMod._spies.reset());

it('indexes Feathery-owned history entries', () => {
  renderRouter();
  const initialState = BrowserMod._spies.history.state;

  fireEvent.click(screen.getByRole('button', { name: 'Next' }));
  const nextState = BrowserMod._spies.history.state;

  expect(initialState.__featheryNavigationIndexes['form-a']).toBe(0);
  expect(nextState.__featheryNavigationIndexes['form-a']).toBe(1);
  expect(screen.getByTestId('path')).toHaveTextContent('/second');
});

it('accepts browser Back when navigation is approved', () => {
  const confirmNavigation = renderRouter(jest.fn(() => true));
  const initialState = BrowserMod._spies.history.state;
  fireEvent.click(screen.getByRole('button', { name: 'Next' }));

  act(() => BrowserMod._spies.emitPop(initialState, '/first'));

  expect(confirmNavigation).toHaveBeenCalledTimes(1);
  expect(BrowserMod._spies.history.go).not.toHaveBeenCalled();
  expect(screen.getByTestId('path')).toHaveTextContent('/first');
});

it('restores browser Back when navigation is declined', () => {
  const confirmNavigation = renderRouter(jest.fn(() => false));
  const initialState = BrowserMod._spies.history.state;
  fireEvent.click(screen.getByRole('button', { name: 'Next' }));
  const nextState = BrowserMod._spies.history.state;

  act(() => BrowserMod._spies.emitPop(initialState, '/first'));

  expect(confirmNavigation).toHaveBeenCalledTimes(1);
  expect(BrowserMod._spies.history.go).toHaveBeenCalledWith(1);
  expect(screen.getByTestId('path')).toHaveTextContent('/second');

  act(() => BrowserMod._spies.emitPop(nextState, '/second'));
  expect(confirmNavigation).toHaveBeenCalledTimes(1);
  expect(screen.getByTestId('path')).toHaveTextContent('/second');
});

it('restores browser Forward when navigation is declined', () => {
  const confirmNavigation = renderRouter(jest.fn(() => true));
  const initialState = BrowserMod._spies.history.state;
  fireEvent.click(screen.getByRole('button', { name: 'Next' }));
  const nextState = BrowserMod._spies.history.state;

  act(() => BrowserMod._spies.emitPop(initialState, '/first'));
  confirmNavigation.mockReturnValue(false);
  BrowserMod._spies.history.go.mockClear();

  act(() => BrowserMod._spies.emitPop(nextState, '/second'));

  expect(confirmNavigation).toHaveBeenCalledTimes(2);
  expect(BrowserMod._spies.history.go).toHaveBeenCalledWith(-1);
  expect(screen.getByTestId('path')).toHaveTextContent('/first');
});

it('does not guard history entries that are not owned by Feathery', () => {
  const confirmNavigation = renderRouter(jest.fn(() => false));

  act(() => BrowserMod._spies.emitPop({ hostRouter: true }, '/outside'));

  expect(confirmNavigation).not.toHaveBeenCalled();
  expect(BrowserMod._spies.history.go).not.toHaveBeenCalled();
  expect(screen.getByTestId('path')).toHaveTextContent('/outside');
});
