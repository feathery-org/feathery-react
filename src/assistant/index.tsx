import { lazy, Suspense } from 'react';
import type { AssistantChatProps } from './AssistantChat';

const LazyAssistantChat = lazy(
  () => import(/* webpackChunkName: "AssistantChat" */ './AssistantChat')
);

export const AssistantChat = (props: AssistantChatProps) => (
  <Suspense fallback={null}>
    <LazyAssistantChat {...props} />
  </Suspense>
);

export type { AssistantChatProps };
