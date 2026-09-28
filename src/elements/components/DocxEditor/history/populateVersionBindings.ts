// Populate a stored version's placeholders the way the live editor does when it
// opens a document. attachBindings runs two steps on open (attachBindings.ts):
//   1. convertTemplateTokens — raw [[field]] / {{ jinja }} tokens become content
//      controls with their value baked into the control's text.
//   2. applyRules — reconciles once so formulas hold their computed values.
// The read-only version viewer runs no binding engine, so a version whose stored
// document still holds raw tokens shows them unpopulated. This helper reproduces
// those two steps as pure functions (the values live inside the token strings —
// no live Feathery field store is needed).
//
// It is a no-op for a document that has no raw tokens (converted === 0): a doc
// serialized from a live edit session is already content-controlled, so it is
// returned untouched — applyRules never runs on it, leaving its tracked-change
// revisions (which the highlights path relies on) exactly as stored.
import { applyRules } from '../bindings/core/engine';
import { convertTemplateTokens } from '../bindings/core/templateImport';
import type { SfdtDocument } from '../bindings/core/sfdtTypes';

export function populateVersionBindings(doc: SfdtDocument): SfdtDocument {
  const converted = convertTemplateTokens(doc);
  // No raw tokens: leave the document (and its revisions) exactly as stored.
  if (!converted.converted) return doc;
  return applyRules(converted.sfdt).sfdt;
}
