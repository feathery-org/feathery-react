// Replays attachBindings' open steps (token convert + applyRules) for the
// read-only viewer, which has no binding engine; values live in the tokens.
import { applyRules } from '../bindings/core/engine';
import { convertTemplateTokens } from '../bindings/core/templateImport';
import type { SfdtDocument } from '../bindings/core/sfdtTypes';

export function populateVersionBindings(doc: SfdtDocument): SfdtDocument {
  const converted = convertTemplateTokens(doc);
  // No raw tokens: leave the document (and its revisions) exactly as stored.
  if (!converted.converted) return doc;
  return applyRules(converted.sfdt).sfdt;
}
