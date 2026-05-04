import { servarValueHandler } from './servarValue';
import type { ResourceHandler } from './types';

/**
 * Registry of ChangeOp resource-type -> handler. Mirrors Builder's
 * `changeOpHandlers/index.ts` so both flows route ops through the
 * same shape.
 */
export const handlerRegistry: Record<string, ResourceHandler> = {
  servar_value: servarValueHandler,
};

export type { AssistantChangeOp, HandlerContext, OperationResult, OperationHandler, ResourceHandler } from './types';
