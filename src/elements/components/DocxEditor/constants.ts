// Pinned Syncfusion Essential JS 2 version. The editor + its dependencies are
// loaded from Syncfusion's CDN at runtime (via the same dynamicImport/script
// pattern used for Calendly, Plaid, etc.) so the multi-MB library never enters
// the SDK bundle.
//
// KEEP IN LOCKSTEP with @syncfusion/ej2-documenteditor in package.json —
// constants.spec.ts enforces it. The tracked-changes review experience
// patches engine INTERNALS (handleAcceptReject, isRevisionMatched,
// checkRevisionType, renderTextElementBox, renderWidgets, selectRevision's
// skipGroupSelect flag) that were probed against this exact version; tests
// exercise the node_modules copy while production loads this CDN copy, so a
// version skew would void everything the real-SDK tests prove. Bumping the
// version means re-running the DocxEditor + assistant ops suites and a
// harness walkthrough.
export const EJ2_VERSION = '34.1.31';

const CDN_BASE = `https://cdn.syncfusion.com/ej2/${EJ2_VERSION}`;

// Single global bundle exposing the `ej.*` namespace
// (ej.documenteditor.DocumentEditorContainer, ej.base.registerLicense, ...).
export const EJ2_SCRIPT_URL = `${CDN_BASE}/dist/ej2.min.js`;

// Theme CSS for the document editor + the controls it renders internally
// (dialogs, dropdowns, buttons). Injected as <link>s into the document head.
export const EJ2_STYLE_URLS = [
  'ej2-base',
  'ej2-buttons',
  'ej2-inputs',
  'ej2-popups',
  'ej2-lists',
  'ej2-navigations',
  'ej2-splitbuttons',
  'ej2-dropdowns',
  'ej2-documenteditor'
].map((pkg) => `${CDN_BASE}/${pkg}/styles/tailwind3.css`);

// Toolbar option lists (ported from the dashboard DocxToolbar).
export const FONTS = [
  'Calibri',
  'Arial',
  'Times New Roman',
  'Georgia',
  'Verdana',
  'Tahoma',
  'Trebuchet MS',
  'Garamond',
  'Courier New',
  'Comic Sans MS'
];
export const FONT_SIZES = [8, 9, 10, 11, 12, 14, 16, 18, 24, 28, 36, 48, 72];
export const ZOOM_PRESETS = [50, 75, 90, 100, 125, 150, 175, 200];
