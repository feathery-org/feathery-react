import React, {
  createContext,
  useState,
  useContext,
  useCallback,
  useMemo,
  type ReactNode,
  useEffect
} from 'react';
import { featheryWindow } from '../utils/browser';

type NavigateOptions = {
  replace?: boolean;
};

type RouterData = {
  location: {
    pathname: string;
  };
  navigate: (to: string, options?: NavigateOptions) => void;
};

type RouterProviderProps = {
  children: ReactNode;
  initialPath?: string;
  navigationId?: string;
  confirmPopNavigation?: () => boolean;
};

const HISTORY_INDEXES_KEY = '__featheryNavigationIndexes';

const getHistoryIndexes = (state: any): Record<string, number> =>
  state && typeof state === 'object' && state[HISTORY_INDEXES_KEY]
    ? state[HISTORY_INDEXES_KEY]
    : {};

const withHistoryIndex = (state: any, navigationId: string, index: number) => ({
  ...(state && typeof state === 'object' ? state : {}),
  [HISTORY_INDEXES_KEY]: {
    ...getHistoryIndexes(state),
    [navigationId]: index
  }
});

const RouterContext = createContext<RouterData>({
  location: {
    pathname: ''
  },
  navigate: () => {}
});

export function RouterProvider({
  children,
  initialPath = featheryWindow().location.pathname,
  navigationId = '__default_form__',
  confirmPopNavigation
}: RouterProviderProps) {
  const [location, setLocation] = useState({ pathname: initialPath });
  const currentHistoryIndex = React.useRef(0);
  const restoringHistoryIndex = React.useRef<number | null>(null);

  useEffect(() => {
    const window = featheryWindow();
    const existingIndex = getHistoryIndexes(window.history.state)[navigationId];
    const initialIndex = typeof existingIndex === 'number' ? existingIndex : 0;
    currentHistoryIndex.current = initialIndex;

    if (typeof existingIndex !== 'number') {
      window.history.replaceState(
        withHistoryIndex(window.history.state, navigationId, initialIndex),
        '',
        window.location.href
      );
    }
  }, [navigationId]);

  const navigate = useCallback(
    (to: string, options: NavigateOptions = {}) => {
      const window = featheryWindow();
      const historyMethod = options.replace ? 'replaceState' : 'pushState';
      const nextIndex = options.replace
        ? currentHistoryIndex.current
        : currentHistoryIndex.current + 1;
      window.history[historyMethod](
        withHistoryIndex(window.history.state, navigationId, nextIndex),
        '',
        to
      );
      currentHistoryIndex.current = nextIndex;
      setLocation({ pathname: to });
    },
    [navigationId]
  );

  // listen to browser back/forward navigation
  useEffect(() => {
    const window = featheryWindow();
    const handlePopState = (event: PopStateEvent) => {
      const destinationIndex = getHistoryIndexes(event.state)[navigationId];

      if (restoringHistoryIndex.current !== null) {
        if (destinationIndex === restoringHistoryIndex.current) {
          currentHistoryIndex.current = destinationIndex;
          restoringHistoryIndex.current = null;
          return;
        }
        restoringHistoryIndex.current = null;
      }

      // Only Feathery-owned entries have an index. Cross-document navigation
      // remains protected by beforeunload, while host SPA navigation must be
      // guarded by the host router.
      if (typeof destinationIndex !== 'number') {
        setLocation({ pathname: window.location.pathname });
        return;
      }

      const delta = destinationIndex - currentHistoryIndex.current;
      if (delta !== 0 && confirmPopNavigation && !confirmPopNavigation()) {
        restoringHistoryIndex.current = currentHistoryIndex.current;
        window.history.go(-delta);
        return;
      }

      currentHistoryIndex.current = destinationIndex;
      setLocation({ pathname: window.location.pathname });
    };

    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, [confirmPopNavigation, navigationId]);

  const routerData = useMemo(
    () => ({
      location,
      navigate
    }),
    [location, navigate]
  );

  return (
    <RouterContext.Provider value={routerData}>
      {children}
    </RouterContext.Provider>
  );
}

export function useLocation() {
  const context = useContext(RouterContext);
  if (!context)
    throw new Error('useLocation must be used within RouterProvider');
  return context.location;
}

export function useNavigate() {
  const context = useContext(RouterContext);
  if (!context)
    throw new Error('useNavigate must be used within RouterProvider');
  return context.navigate;
}
