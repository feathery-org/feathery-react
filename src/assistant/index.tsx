import { lazy, Suspense } from 'react';
import type { AssistantChatProps } from './AssistantChat';
import type { ChatRegistryProviderProps } from './ChatRegistryProvider';

const LazyAssistantChat = lazy(
  () => import(/* webpackChunkName: "AssistantChat" */ './AssistantChat')
);

const LazyChatRegistryProvider = lazy(() =>
  import(/* webpackChunkName: "AssistantChat" */ './ChatRegistryProvider').then(
    (m) => ({ default: m.ChatRegistryProvider })
  )
);

export function AssistantChat(props: AssistantChatProps) {
  return (
    <Suspense fallback={null}>
      <LazyAssistantChat {...props} />
    </Suspense>
  );
}

export function ChatRegistryProvider(props: ChatRegistryProviderProps) {
  return (
    <Suspense fallback={null}>
      <LazyChatRegistryProvider {...props} />
    </Suspense>
  );
}

export type { AssistantChatProps, ChatRegistryProviderProps };
