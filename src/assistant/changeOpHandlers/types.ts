/**
 * Mirrors Builder's `changeOpHandlers/types.ts`. The Assistant's resource
 * surface is much smaller than Builder's (form-runtime field writes only,
 * for now), but the shapes line up so a future expansion (e.g. step
 * navigation) can drop a new handler in alongside.
 */

export type AssistantChangeOp = {
  id: string;
  operation: 'create' | 'update' | 'delete';
  target: { type: string; id: string };
  payload: { value?: unknown; [k: string]: unknown };
};

/**
 * Per-handler context. Builder threads dispatch/store/jwt; we only need
 * the form's internal UUID (the key into `internalState`). Adding more
 * fields here is the natural place for future write tools.
 */
export type HandlerContext = {
  formUuid: string | undefined;
};

/**
 * Mirrors Builder's `OperationResult`: optional id-resolution payload
 * plus an undefined return for handlers that don't surface ids. Stays
 * void today; kept for symmetry.
 */
export type OperationResult =
  | {
      realId: string;
      secondaryIds?: Record<string, string>;
    }
  | void;

export type OperationHandler = (
  op: AssistantChangeOp,
  ctx: HandlerContext
) => OperationResult | Promise<OperationResult>;

export type ResourceHandler = {
  create?: OperationHandler;
  update?: OperationHandler;
  delete?: OperationHandler;
};
