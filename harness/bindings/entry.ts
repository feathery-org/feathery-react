// Harness entry: exposes the PORTED binding engine on window for a plain HTML
// page to drive.
//
// This exists because jsdom cannot test the things that actually break in a
// browser. It has no real caret, so the keystroke guard's reach is unproven; it
// cannot fire the hidden editable div's textInput or blur; and the ORDER of
// contentChange/selectionChange under real typing is exactly what the commit
// triggers depend on. Everything here is the shipped code - no forks, no fakes -
// so what the page does is what a form does.
//
// Not part of the package build. See harness/bindings/README.md.

import { attachBindings } from '../../src/elements/components/DocxEditor/bindings/attachBindings';
import {
  applyRules,
  hasBlockingErrors
} from '../../src/elements/components/DocxEditor/bindings/core/engine';
import {
  addLineItem,
  removeLineItem,
  scanBindings,
  setTaggedValue
} from '../../src/elements/components/DocxEditor/bindings/core/sfdtAdapter';
import {
  anchorCaret,
  innerRangeOf,
  snapOffsetForCaret
} from '../../src/elements/components/DocxEditor/bindings/controlGeometry';
import { convertTemplateTokens } from '../../src/elements/components/DocxEditor/bindings/core/templateImport';
import { isOptimizedSfdt } from '../../src/elements/components/DocxEditor/bindings/core/sfdtTypes';
import { parseTag } from '../../src/elements/components/DocxEditor/bindings/core/tagDsl';
import { buildCostsFixture } from '../../src/elements/components/DocxEditor/bindings/core/tests/fixtures/costsFixture';
import { buildTemplateTokenDocument } from '../../src/elements/components/DocxEditor/bindings/core/tests/fixtures/templateTokenFixture';
import { createDocxEditorBridge } from '../../src/assistant/tools/docx/docxEditorBridge';
import { flattenSfdt } from '../../src/assistant/tools/docx/syncfusionDocumentOps';

// Browser-only harness bootstrap: attaching to the real window IS the point, so
// the SSR-safety rule does not apply here.
// eslint-disable-next-line no-restricted-globals
(window as any).Bindings = {
  attachBindings,
  // The pure engine, for poking at a document straight from the console.
  applyRules,
  hasBlockingErrors,
  // Adapter operations the page drives through controller.runCommand.
  addLineItem,
  removeLineItem,
  setTaggedValue,
  scanBindings,
  convertTemplateTokens,
  isOptimizedSfdt,
  parseTag,
  // Caret geometry, for checking from the console whether the caret is actually
  // inside a binding - the difference is one offset and invisible on screen.
  // Bindings.innerRangeOf(editor, control) / Bindings.snapOffsetForCaret(editor)
  anchorCaret,
  innerRangeOf,
  snapOffsetForCaret,
  // Two documents: one already bound, one still carrying [[...]] tokens so the
  // import path is visible too.
  buildCostsFixture,
  buildTemplateTokenDocument,
  // The assistant's own bridge, unchanged: robin-bound-ops.html drives a bound
  // document through exactly the entry point Robin's tool dispatch uses, so the
  // routing decision (engine vs tracked write) is the shipped one.
  createDocxEditorBridge,
  flattenSfdt
};
