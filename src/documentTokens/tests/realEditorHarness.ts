/**
 * A real `DocumentEditor`, in jsdom, carrying real token content controls.
 *
 * This is the piece that was missing. `insertContentControl` is a no-op in
 * ej2 v34 (measured), so tokens could not be built through the editor's API and
 * every test had to use a hand-written fake — which is why the fake kept
 * agreeing with assumptions the real editor contradicted.
 *
 * SFDT declares an inline content control as an inline carrying
 * `contentControlProperties` plus a nested `inlines` array holding its content,
 * which `SfdtReader.parseParagraph` turns into a start/end ContentControl pair
 * around the text. Building that JSON directly sidesteps the missing API and
 * needs no server round trip.
 */

import 'jest-canvas-mock';
import {
  DocumentEditor,
  Editor,
  EditorHistory,
  Search,
  Selection,
  SfdtExport
} from '@syncfusion/ej2-documenteditor';

import { bookmarkFor, encodeTag } from '../controls';
import { instanceKey, TokenSpec } from '../plan';

DocumentEditor.Inject(Editor, Selection, SfdtExport, EditorHistory, Search);

/** jsdom lacks the two browser APIs the editor reaches for on construction. */
const shimBrowser = (): void => {
  if (!window.crypto?.getRandomValues) {
    Object.defineProperty(window, 'crypto', {
      value: {
        // eslint-disable-next-line global-require
        getRandomValues: (array: Uint8Array) =>
          require('crypto').randomFillSync(array)
      }
    });
  }
  if (!(window.SVGElement.prototype as any).getBBox) {
    (window.SVGElement.prototype as any).getBBox = () =>
      ({ x: 0, y: 0, width: 0, height: 0 } as DOMRect);
  }
};

export type TokenFixture = { spec: TokenSpec; text: string };

/**
 * One token: the control carrying its spec, bookmarked the way `wrap.py` does,
 * with the locks a filled envelope carries.
 */
const tokenInline = ({ spec, text }: TokenFixture) => {
  const instance = instanceKey(spec);
  return {
    contentControlProperties: {
      tag: encodeTag(spec),
      title: spec.id,
      type: 'Text',
      // Required: the border renderer reads this and throws on undefined, which
      // then breaks every later gesture. Syncfusion's own default.
      color: '#00000000',
      // Measured: a computed token's contents are locked and every token's
      // control is locked against deletion. Neither actually prevents damage.
      lockContents: Boolean(spec.formula),
      lockContentControl: true
    },
    inlines: [
      { bookmarkType: 0, name: bookmarkFor(instance) },
      { text },
      { bookmarkType: 1, name: bookmarkFor(instance) }
    ]
  };
};

/** A document reading `<id>: <token> end` per token, one paragraph each. */
const tokenSfdt = (tokens: TokenFixture[]) => ({
  sections: [
    {
      blocks: [
        { inlines: [{ text: 'Invoice' }] },
        ...tokens.map((token) => ({
          inlines: [
            { text: `${token.spec.id}: ` },
            tokenInline(token),
            { text: ' end' }
          ]
        })),
        { inlines: [{ text: 'Thank you' }] }
      ]
    }
  ]
});

export type RealTokenEditor = {
  editor: DocumentEditor;
  destroy: () => void;
};

export const makeTokenEditor = (tokens: TokenFixture[]): RealTokenEditor => {
  shimBrowser();
  const host = document.createElement('div');
  host.style.width = '900px';
  host.style.height = '700px';
  document.body.appendChild(host);

  const editor = new DocumentEditor({
    isReadOnly: false,
    enableEditor: true,
    enableSelection: true,
    enableSfdtExport: true,
    enableEditorHistory: true
  });
  editor.appendTo(host);
  editor.open(JSON.stringify(tokenSfdt(tokens)));

  return {
    editor,
    destroy: () => {
      const element = editor.element;
      editor.destroy();
      element?.remove();
    }
  };
};

/** Put the selection over one token's value, by its address. */
export const selectToken = (
  editor: DocumentEditor,
  instance: string
): boolean => {
  const collection: any[] =
    (editor as any)?.documentHelper?.contentControlCollection ?? [];
  const control = collection.find((candidate) => {
    const tag = candidate?.contentControlProperties?.tag;
    return typeof tag === 'string' && tag.includes(`"${instance}"`);
  });

  if (control) {
    (editor.selection as any).selectContentControlInternal(control);
    return true;
  }

  // The bookmark addresses an untouched token perfectly well.
  const bookmark = bookmarkFor(instance);
  if (!editor.getBookmarks().includes(bookmark)) return false;
  editor.selection.selectBookmark(bookmark, true);
  return true;
};
