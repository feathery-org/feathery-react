import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import {
  _resetRouterHistory,
  RouterProvider,
  useLocation,
  useNavigate
} from './router';

jest.mock('../utils/browser', () => {
  const popStateHandlers = new Set<any>();
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
    popStateHandlers,
    addEventListener: jest.fn((type: string, handler: any) => {
      if (type === 'popstate') popStateHandlers.add(handler);
    }),
    removeEventListener: jest.fn((type: string, handler: any) => {
      if (type === 'popstate') popStateHandlers.delete(handler);
    }),
    emitPop: (nextState: any, pathname: string) => {
      history.state = nextState;
      location.pathname = pathname;
      [...popStateHandlers].forEach((handler) =>
        handler({ state: nextState } as PopStateEvent)
      );
    },
    reset: () => {
      popStateHandlers.clear();
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

function RouterHarness({ id, to }: { id: string; to: string }) {
  const location = useLocation();
  const navigate = useNavigate();
  return (
    <>
      <span data-testid={`path:${id}`}>{location.pathname}</span>
      <button type='button' onClick={() => navigate(to)}>
        {`Next ${id}`}
      </button>
    </>
  );
}

const renderRouter = (confirmPopNavigation = jest.fn(() => true)) => {
  render(
    <RouterProvider confirmPopNavigation={confirmPopNavigation}>
      <RouterHarness id='a' to='/second' />
    </RouterProvider>
  );
  return confirmPopNavigation;
};

beforeEach(() => {
  BrowserMod._spies.reset();
  _resetRouterHistory();
});

it('indexes Feathery-owned history entries', () => {
  renderRouter();
  const initialState = BrowserMod._spies.history.state;

  fireEvent.click(screen.getByRole('button', { name: 'Next a' }));
  const nextState = BrowserMod._spies.history.state;

  expect(initialState.__featheryHistoryIndex).toBe(0);
  expect(nextState.__featheryHistoryIndex).toBe(1);
  expect(screen.getByTestId('path:a')).toHaveTextContent('/second');
});

it('accepts browser Back when navigation is approved', () => {
  const confirmNavigation = renderRouter(jest.fn(() => true));
  const initialState = BrowserMod._spies.history.state;
  fireEvent.click(screen.getByRole('button', { name: 'Next a' }));

  act(() => BrowserMod._spies.emitPop(initialState, '/first'));

  expect(confirmNavigation).toHaveBeenCalledTimes(1);
  expect(BrowserMod._spies.history.go).not.toHaveBeenCalled();
  expect(screen.getByTestId('path:a')).toHaveTextContent('/first');
});

it('restores browser Back when navigation is declined', () => {
  const confirmNavigation = renderRouter(jest.fn(() => false));
  const initialState = BrowserMod._spies.history.state;
  fireEvent.click(screen.getByRole('button', { name: 'Next a' }));
  const nextState = BrowserMod._spies.history.state;

  act(() => BrowserMod._spies.emitPop(initialState, '/first'));

  expect(confirmNavigation).toHaveBeenCalledTimes(1);
  expect(BrowserMod._spies.history.go).toHaveBeenCalledWith(1);
  expect(screen.getByTestId('path:a')).toHaveTextContent('/second');

  act(() => BrowserMod._spies.emitPop(nextState, '/second'));
  expect(confirmNavigation).toHaveBeenCalledTimes(1);
  expect(screen.getByTestId('path:a')).toHaveTextContent('/second');
});

it('restores browser Forward when navigation is declined', () => {
  const confirmNavigation = renderRouter(jest.fn(() => true));
  const initialState = BrowserMod._spies.history.state;
  fireEvent.click(screen.getByRole('button', { name: 'Next a' }));
  const nextState = BrowserMod._spies.history.state;

  act(() => BrowserMod._spies.emitPop(initialState, '/first'));
  confirmNavigation.mockReturnValue(false);
  BrowserMod._spies.history.go.mockClear();

  act(() => BrowserMod._spies.emitPop(nextState, '/second'));

  expect(confirmNavigation).toHaveBeenCalledTimes(2);
  expect(BrowserMod._spies.history.go).toHaveBeenCalledWith(-1);
  expect(screen.getByTestId('path:a')).toHaveTextContent('/first');
});

it('does not guard history entries that are not owned by Feathery', () => {
  const confirmNavigation = renderRouter(jest.fn(() => false));

  act(() => BrowserMod._spies.emitPop({ hostRouter: true }, '/outside'));

  expect(confirmNavigation).not.toHaveBeenCalled();
  expect(BrowserMod._spies.history.go).not.toHaveBeenCalled();
  expect(screen.getByTestId('path:a')).toHaveTextContent('/outside');
});

describe('multiple form instances sharing one browser history', () => {
  const renderTwoForms = (
    confirmA = jest.fn(() => true),
    confirmB = jest.fn(() => true)
  ) => {
    render(
      <>
        <RouterProvider confirmPopNavigation={confirmA}>
          <RouterHarness id='a' to='/a-second' />
        </RouterProvider>
        <RouterProvider confirmPopNavigation={confirmB}>
          <RouterHarness id='b' to='/b-second' />
        </RouterProvider>
      </>
    );
    return { confirmA, confirmB };
  };

  it('shares a single position counter across providers', () => {
    renderTwoForms();
    const initialState = BrowserMod._spies.history.state;

    fireEvent.click(screen.getByRole('button', { name: 'Next a' }));
    fireEvent.click(screen.getByRole('button', { name: 'Next a' }));
    fireEvent.click(screen.getByRole('button', { name: 'Next b' }));

    expect(initialState.__featheryHistoryIndex).toBe(0);
    expect(BrowserMod._spies.history.state.__featheryHistoryIndex).toBe(3);
  });

  it('restores the full jump distance when either form declines', () => {
    const { confirmA, confirmB } = renderTwoForms(
      jest.fn(() => true),
      jest.fn(() => false)
    );
    const initialState = BrowserMod._spies.history.state;

    fireEvent.click(screen.getByRole('button', { name: 'Next a' }));
    fireEvent.click(screen.getByRole('button', { name: 'Next a' }));
    fireEvent.click(screen.getByRole('button', { name: 'Next b' }));

    act(() => BrowserMod._spies.emitPop(initialState, '/first'));

    expect(confirmA).toHaveBeenCalledTimes(1);
    expect(confirmB).toHaveBeenCalledTimes(1);
    // 3 entries back, not the -1 a per-provider counter would have computed
    expect(BrowserMod._spies.history.go).toHaveBeenCalledTimes(1);
    expect(BrowserMod._spies.history.go).toHaveBeenCalledWith(3);
  });

  it('asks every mounted form before allowing the pop', () => {
    const { confirmA, confirmB } = renderTwoForms();
    const initialState = BrowserMod._spies.history.state;
    fireEvent.click(screen.getByRole('button', { name: 'Next a' }));

    act(() => BrowserMod._spies.emitPop(initialState, '/first'));

    expect(confirmA).toHaveBeenCalledTimes(1);
    expect(confirmB).toHaveBeenCalledTimes(1);
    expect(BrowserMod._spies.history.go).not.toHaveBeenCalled();
    expect(screen.getByTestId('path:a')).toHaveTextContent('/first');
    expect(screen.getByTestId('path:b')).toHaveTextContent('/first');
  });

  it('keeps one popstate listener while any provider is mounted', () => {
    const view = render(
      <>
        <RouterProvider>
          <RouterHarness id='a' to='/a-second' />
        </RouterProvider>
        <RouterProvider>
          <RouterHarness id='b' to='/b-second' />
        </RouterProvider>
      </>
    );

    expect(BrowserMod._spies.popStateHandlers.size).toBe(1);
    view.unmount();
    expect(BrowserMod._spies.popStateHandlers.size).toBe(0);
  });
});
