// Pinned Syncfusion Essential JS 2 version. The editor + its dependencies are
// loaded from Syncfusion's CDN at runtime (via the same dynamicImport/script
// pattern used for Calendly, Plaid, etc.) so the multi-MB library never enters
// the SDK bundle.
//
// KEEP IN LOCKSTEP with @syncfusion/ej2-documenteditor in package.json
// (constants.spec.ts enforces it): the tracked-changes work patches engine
// internals probed against this exact version, and tests exercise the
// node_modules copy while production loads this CDN copy.
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

// SHA-384 of the pinned CDN responses; update alongside EJ2_VERSION.
// The CDN returns Access-Control-Allow-Origin:* for requests with an Origin.
export const EJ2_STYLE_INTEGRITY: Record<string, string> = Object.fromEntries(
  EJ2_STYLE_URLS.map((url, index) => [
    url,
    [
      'sha384-im0UcPOsKbiwTIbx7XWgov61JG4891/ONT+ds93iBfAVGRWhT5hGHXO2oM77YJYz',
      'sha384-QOaD342ZPLYMiu4iBHW6/7hz85WrotceVU0tnm9MAFGHmFq6DGpIoPqZRYXLgiPJ',
      'sha384-tyiSBip4rm0k1ZxEESUOMbUZuNEOXLUP/mt7/4ZkZAwBZdTxq55OGavWLDEUPuNT',
      'sha384-Lu++yFIIRLQB+CygDFqxIrHz79kxwBkLC/I4QfiHv/AunPkYpwX7bdI9qWbyjHCF',
      'sha384-jdhn1+n7YHBprACwQOqSxc6m3EGKruyNLmj4/YrQEF+9qsLZvw7DfXqampCi87IE',
      'sha384-UE9iptkRIjBwz1+QSe5ViA+cCNqjrQByxaIiLw8PDastJrqRD+syEJbTG3qUtbLk',
      'sha384-McUQBV3c5P/8lqTj8OXF3yXcm67us//0W0ABeRD0zswE/N9ue3U2jgFyFE3nhn6f',
      'sha384-/3VPDD2xSWNAGOkFKuHiP8fimNIZh8gTEYTmMPIe2LQ4I4ZxYpiS1YGezW62jUGg',
      'sha384-kfR3/otg+UcTXMXQnfh86q/gd3sXa18LYEBhvxzOFT7jdDeQIx+6IcoSmUS7uzb1'
    ][index]
  ])
);

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
