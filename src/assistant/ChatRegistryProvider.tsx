import {
  createContext,
  MutableRefObject,
  ReactNode,
  useContext,
  useMemo,
  useRef
} from 'react';
import { initInfo } from '../utils/init';
import { getCookie } from '../utils/browser';
import useChatThreads from './hooks/useChatThreads';
import type { AssistantHeaders, ResourceRef } from './types';

type ChatRegistryValue = ReturnType<typeof useChatThreads> & {
  baseUrl: string;
  headers: AssistantHeaders;
  voiceActiveRef: MutableRefObject<boolean>;
};

const ChatRegistryContext = createContext<ChatRegistryValue | null>(null);

export function useChatRegistry(): ChatRegistryValue {
  const value = useContext(ChatRegistryContext);
  if (!value) {
    throw new Error(
      'useChatRegistry must be used within a ChatRegistryProvider'
    );
  }
  return value;
}

export type ChatRegistryProviderProps = {
  baseUrl: string;
  headers?: AssistantHeaders;
  getJwt?: () => string;
  instanceId?: string;
  getTargets: () => ResourceRef[];
  children: ReactNode;
};

export function ChatRegistryProvider({
  baseUrl,
  headers,
  getJwt,
  instanceId,
  getTargets,
  children
}: ChatRegistryProviderProps) {
  const resolvedHeaders = useMemo<AssistantHeaders>(() => {
    if (headers) return headers;
    if (getJwt) return () => ({ Authorization: `Bearer ${getJwt()}` });
    const { sdkKey } = initInfo();
    return () => {
      const h: Record<string, string> = {
        Authorization: `Token ${sdkKey}`
      };
      const sessionJwt = getCookie('feathery_session_token');
      if (sessionJwt) h['X-Feathery-Session'] = sessionJwt;
      return h;
    };
  }, [headers, getJwt]);

  const voiceActiveRef = useRef(false);

  const threadState = useChatThreads({
    baseUrl,
    headers: resolvedHeaders,
    instanceId,
    getTargets,
    voiceActiveRef
  });

  const value = useMemo<ChatRegistryValue>(
    () => ({
      ...threadState,
      baseUrl,
      headers: resolvedHeaders,
      voiceActiveRef
    }),
    [threadState, baseUrl, resolvedHeaders]
  );

  return (
    <ChatRegistryContext.Provider value={value}>
      {children}
    </ChatRegistryContext.Provider>
  );
}

export default ChatRegistryProvider;
