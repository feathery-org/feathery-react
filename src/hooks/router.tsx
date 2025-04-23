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
};

const RouterContext = createContext<RouterData>({
  location: {
    pathname: ''
  },
  navigate: () => {}
});

export function RouterProvider({
  children,
  initialPath = featheryWindow().location.pathname
}: RouterProviderProps) {
  const [location, setLocation] = useState({ pathname: initialPath });

  const navigate = useCallback((to: string, options: NavigateOptions = {}) => {
    const historyMethod = options.replace ? 'replaceState' : 'pushState';
    featheryWindow().history[historyMethod](null, '', to);
    setLocation({ pathname: to });
  }, []);

  // listen to browser back/forward navigation
  useEffect(() => {
    const window = featheryWindow();
    const handlePopState = () => {
      setLocation({ pathname: window.location.pathname });
    };

    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
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
