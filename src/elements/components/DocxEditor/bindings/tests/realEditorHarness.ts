// Shared harness for the binding-engine spikes: a real DocumentEditor from the
// pinned npm build (34.1.31), driven in jsdom, plus SFDT builders that wrap text
// in content controls carrying a `[[...]]` tag.
//
// The spikes exist to answer, against the real engine rather than by reading
// docs, whether a tag written into `contentControlProperties.tag` survives every
// boundary the reconcile loop and the save path cross. Tag strings here are
// literals on purpose - the tag DSL is not ported yet, and the representation
// must be provable without it.
import 'jest-canvas-mock';
import {
  DocumentEditor,
  Editor,
  EditorHistory,
  ImageResizer,
  Search,
  Selection,
  SfdtExport,
  WordExport
} from '@syncfusion/ej2-documenteditor';

DocumentEditor.Inject(
  Editor,
  Selection,
  SfdtExport,
  EditorHistory,
  ImageResizer,
  Search,
  WordExport
);

// jsdom gaps the engine trips over: revision ids come from crypto, and the
// canvas renderer measures SVG. Same shims the assistant docx specs install.
if (!window.crypto?.getRandomValues) {
  Object.defineProperty(window, 'crypto', {
    value: {
      getRandomValues: (array: Uint8Array) =>
        require('crypto').randomFillSync(array)
    }
  });
}
if (!(window.SVGElement.prototype as any).getBBox) {
  (window.SVGElement.prototype as any).getBBox = () =>
    ({ x: 0, y: 0, width: 0, height: 0 } as DOMRect);
}

export interface HarnessOptions {
  /**
   * Syncfusion defaults this to true, which makes `serialize()` emit minified
   * short keys (`ccp` for contentControlProperties). The binding adapter reads
   * full keywords, so the port must pin it false - the spikes assert both ways.
   */
  optimizeSfdt?: boolean;
}

export function makeRealDocumentEditor(
  sfdt: unknown,
  options: HarnessOptions = {}
): DocumentEditor {
  const host = document.createElement('div');
  host.style.width = '900px';
  host.style.height = '700px';
  document.body.appendChild(host);
  const editor = new DocumentEditor({
    isReadOnly: false,
    enableEditor: true,
    enableSelection: true,
    enableImageResizer: true,
    enableSearch: true,
    enableSfdtExport: true,
    enableWordExport: true,
    enableEditorHistory: true,
    documentEditorSettings: { optimizeSfdt: options.optimizeSfdt ?? false }
  });
  editor.appendTo(host);
  editor.open(JSON.stringify(sfdt));
  return editor;
}

export function destroyRealDocumentEditor(editor: DocumentEditor): void {
  const element = editor.element;
  editor.destroy();
  element?.remove();
}

/**
 * An inline content control wrapping one run - the POC's field/formula shape.
 *
 * The property set is not decoration. `color` in particular is mandatory: the
 * SFDT reader only assigns it when supplied (sfdt-reader.js:1250), and the
 * border renderer calls `.length` on it as soon as the caret enters the control,
 * so a control synthesized without a color crashes the editor on first focus.
 * `'#00000000'` is transparent, which the renderer maps to grey.
 */
export function taggedInline(
  tag: string,
  text: string,
  options: {
    lockContents?: boolean;
    title?: string;
    /** Escape hatch for the spec that proves color is required. */
    omitColor?: boolean;
  } = {}
) {
  return {
    contentControlProperties: {
      lockContentControl: true,
      lockContents: options.lockContents ?? false,
      tag,
      title: options.title ?? tag,
      type: 'Text',
      hasPlaceHolderText: false,
      multiline: false,
      isTemporary: false,
      appearance: 'BoundingBox',
      ...(options.omitColor ? {} : { color: '#00000000' })
    },
    inlines: [{ text }]
  };
}

export const para = (...inlines: unknown[]) => ({ inlines });
export const textRun = (text: string) => ({ text });

export const cell = (...blocks: unknown[]) => ({ cellFormat: {}, blocks });
export const cellText = (text: string) => cell(para(textRun(text)));
export const cellTagged = (tag: string, text: string) =>
  cell(para(taggedInline(tag, text)));

export const row = (...cells: unknown[]) => ({ rowFormat: {}, cells });
export const table = (...rows: unknown[]) => ({ tableFormat: {}, rows });

export const docWith = (...blocks: unknown[]) => ({
  sections: [{ blocks, headersFooters: {} }]
});

/**
 * Every content-control tag the engine can see in a serialized document, in
 * document order. Reads both keyword forms so a spec can prove which form a
 * given serialize() produced rather than assuming one.
 */
export function collectTags(node: unknown, found: string[] = []): string[] {
  if (Array.isArray(node)) {
    for (const item of node) collectTags(item, found);
    return found;
  }
  if (!node || typeof node !== 'object') return found;
  const record = node as Record<string, unknown>;
  const properties = (record.contentControlProperties ?? record.ccp) as
    | Record<string, unknown>
    | undefined;
  if (properties && typeof properties === 'object') {
    // Minified SFDT renames both the wrapper and the tag: `contentControlProperties`
    // -> `ccp`, `tag` -> `tg` (ej2 keywords.js:272,275).
    const tag = properties.tag ?? properties.tg;
    if (typeof tag === 'string') found.push(tag);
  }
  for (const value of Object.values(record)) collectTags(value, found);
  return found;
}

/** True when a serialized document uses Syncfusion's minified keyword set. */
export function isOptimizedSfdt(serialized: string): boolean {
  const parsed = JSON.parse(serialized);
  return Array.isArray(parsed.sec) && !Array.isArray(parsed.sections);
}
