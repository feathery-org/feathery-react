import { AdvertisedDocumentOp, DOCUMENT_EDITOR_CAPABILITIES } from './registry';

/**
 * The capability declaration carries only protocol facts and operation names.
 * ai-services owns model-facing tool descriptions and schemas; frontend-authored
 * receipts and refusal messages still return to the model as tool output.
 */
export interface CapabilitiesDeclaration {
  documentProtocolVersion: '2';
  supportedOperations: AdvertisedDocumentOp[];
}

export function buildCapabilitiesDeclaration(): CapabilitiesDeclaration {
  return {
    documentProtocolVersion: '2',
    supportedOperations: DOCUMENT_EDITOR_CAPABILITIES.map((entry) => entry.op)
  };
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object') {
    Object.values(value as Record<string, unknown>).forEach(deepFreeze);
    Object.freeze(value);
  }
  return value;
}

export const CAPABILITIES_DECLARATION: CapabilitiesDeclaration = deepFreeze(
  buildCapabilitiesDeclaration()
);
