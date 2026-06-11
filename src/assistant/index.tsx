import { lazy, Suspense } from 'react';
import type { AssistantChatProps } from './AssistantChat';
import { FeatheryCacheProvider } from '../utils/emotionCache';

const LazyAssistantChat = lazy(
  () => import(/* webpackChunkName: "AssistantChat" */ './AssistantChat')
);

export const AssistantChat = (props: AssistantChatProps) => (
  <FeatheryCacheProvider>
    <Suspense fallback={null}>
      <LazyAssistantChat {...props} />
    </Suspense>
  </FeatheryCacheProvider>
);

export type { AssistantChatProps };
