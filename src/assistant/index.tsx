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

export const AssistantChat = (props: AssistantChatProps) => (
  <Suspense fallback={null}>
    <LazyAssistantChat {...props} />
  </Suspense>
);

export const ChatRegistryProvider = (props: ChatRegistryProviderProps) => (
  <Suspense fallback={null}>
    <LazyChatRegistryProvider {...props} />
  </Suspense>
);

export type { AssistantChatProps, ChatRegistryProviderProps };
