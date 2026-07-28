import { AdvertisedDocumentOp, DOCUMENT_EDITOR_CAPABILITIES } from './registry';

/**
 * Machine-only facts about the form document executor. ai-services owns every
 * description, example, payload rule, schema, and result shape the model sees.
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
