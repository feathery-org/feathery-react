import React, {
  createContext,
  useState,
  useContext,
  useCallback,
  useMemo,
  useRef,
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
  confirmPopNavigation?: () => boolean;
};

type Subscriber = {
  syncLocation: (pathname: string) => void;
  confirmPopNavigation: () => boolean;
};

const HISTORY_INDEX_KEY = '__featheryHistoryIndex';

const getHistoryIndex = (state: any): number | undefined => {
  const index =
    state && typeof state === 'object' ? state[HISTORY_INDEX_KEY] : undefined;
  return typeof index === 'number' ? index : undefined;
};

const withHistoryIndex = (state: any, index: number) => ({
  ...(state && typeof state === 'object' ? state : {}),
  [HISTORY_INDEX_KEY]: index
});

// Browser history is page-wide, so a single module-level owner indexes it for
// every mounted RouterProvider — per-provider counters drift once two forms
// interleave pushes, and the undo delta then targets the wrong entry.
const subscribers = new Set<Subscriber>();
let currentHistoryIndex = 0;
// Where we asked the browser to return after a declined pop, so that pop is
// swallowed instead of re-prompting
let restoringHistoryIndex: number | null = null;
let popStateListener: ((event: PopStateEvent) => void) | null = null;

const syncSubscriberLocations = () => {
  const { pathname } = featheryWindow().location;
  subscribers.forEach((subscriber) => subscriber.syncLocation(pathname));
};

const handlePopState = (event: PopStateEvent) => {
  const window = featheryWindow();
  const destinationIndex = getHistoryIndex(event.state);

  if (restoringHistoryIndex !== null) {
    const restored = destinationIndex === restoringHistoryIndex;
    restoringHistoryIndex = null;
    if (restored) {
      currentHistoryIndex = destinationIndex as number;
      return;
    }
  }

  // Only Feathery-owned entries carry an index. Cross-document navigation
  // remains protected by beforeunload, while host SPA navigation must be
  // guarded by the host router.
  if (destinationIndex === undefined) {
    syncSubscriberLocations();
    return;
  }

  const delta = destinationIndex - currentHistoryIndex;
  if (delta !== 0) {
    const declined = [...subscribers].some(
      (subscriber) => !subscriber.confirmPopNavigation()
    );
    if (declined) {
      restoringHistoryIndex = currentHistoryIndex;
      window.history.go(-delta);
      return;
    }
  }

  currentHistoryIndex = destinationIndex;
  syncSubscriberLocations();
};

const subscribeToHistory = (subscriber: Subscriber) => {
  const window = featheryWindow();

  // Adopt the index already on the entry when another provider (or a reload of
  // a Feathery-pushed entry) got here first.
  const existingIndex = getHistoryIndex(window.history.state);
  if (existingIndex === undefined) {
    window.history.replaceState(
      withHistoryIndex(window.history.state, currentHistoryIndex),
      '',
      window.location.href
    );
  } else currentHistoryIndex = existingIndex;

  subscribers.add(subscriber);
  if (!popStateListener) {
    popStateListener = handlePopState;
    window.addEventListener('popstate', popStateListener);
  }

  return () => {
    subscribers.delete(subscriber);
    if (subscribers.size === 0 && popStateListener) {
      featheryWindow().removeEventListener('popstate', popStateListener);
      popStateListener = null;
    }
  };
};

export const _resetRouterHistory = () => {
  if (popStateListener) {
    featheryWindow().removeEventListener('popstate', popStateListener);
    popStateListener = null;
  }
  subscribers.clear();
  currentHistoryIndex = 0;
  restoringHistoryIndex = null;
};

const RouterContext = createContext<RouterData>({
  location: {
    pathname: ''
  },
  navigate: () => {}
});

export function RouterProvider({
  children,
  initialPath = featheryWindow().location.pathname,
  confirmPopNavigation
}: RouterProviderProps) {
  const [location, setLocation] = useState({ pathname: initialPath });
  // Kept in a ref so a new callback identity doesn't resubscribe the listener
  const confirmRef = useRef(confirmPopNavigation);
  confirmRef.current = confirmPopNavigation;

  useEffect(
    () =>
      subscribeToHistory({
        syncLocation: (pathname) => setLocation({ pathname }),
        confirmPopNavigation: () => confirmRef.current?.() ?? true
      }),
    []
  );

  const navigate = useCallback((to: string, options: NavigateOptions = {}) => {
    const window = featheryWindow();
    const historyMethod = options.replace ? 'replaceState' : 'pushState';
    const nextIndex = options.replace
      ? currentHistoryIndex
      : currentHistoryIndex + 1;
    window.history[historyMethod](
      withHistoryIndex(window.history.state, nextIndex),
      '',
      to
    );
    currentHistoryIndex = nextIndex;
    setLocation({ pathname: to });
  }, []);

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
