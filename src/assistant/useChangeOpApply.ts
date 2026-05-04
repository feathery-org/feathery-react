import { useCallback } from 'react';

import { handlerRegistry } from './changeOpHandlers';
import type { AssistantChangeOp, HandlerContext, OperationResult } from './changeOpHandlers/types';

/**
 * Returns `applyChangeOp(op)`: routes a ChangeOp through the handler
 * registry by `target.type` then `operation`. Mirrors Builder's
 * `useChangeOpApply` 1:1, minus Redux/JWT (we only need the form
 * UUID for `internalState` lookup).
 */
export function useChangeOpApply(formUuid: string | undefined) {
  const applyChangeOp = useCallback(
    async (op: AssistantChangeOp): Promise<OperationResult> => {
      const handler = handlerRegistry[op.target.type];
      if (!handler) {
        throw new Error(`[useChangeOpApply] unsupported resource type: ${op.target.type}`);
      }
      const operationFn = handler[op.operation];
      if (!operationFn) {
        throw new Error(`[useChangeOpApply] no ${op.operation} handler for: ${op.target.type}`);
      }
      const ctx: HandlerContext = { formUuid };
      return operationFn(op, ctx);
    },
    [formUuid]
  );

  return { applyChangeOp };
}
