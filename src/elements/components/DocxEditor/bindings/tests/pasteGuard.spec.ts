import {
  collectTags,
  destroyRealDocumentEditor,
  docWith,
  makeRealDocumentEditor,
  para,
  taggedInline,
  textRun
} from './realEditorHarness';
import { installPasteGuard, pastedText } from '../pasteGuard';

type AnyEditor = any;

const PREMIUM = '[[name=premium|type=currency]]';
const TOTAL = '[[name=total|type=currency|expr=sum(1,2)]]';

// What a copy of the bound value carries: the control itself, as Syncfusion copies it
const copiedControl = (tag: string, text: string) =>
  JSON.stringify(docWith(para(taggedInline(tag, text))));

/** Put a collapsed caret inside the control tagged `tag`, or outside every control when null */
function placeCaret(editor: AnyEditor, tag: string | null): void {
  for (let offset = 0; offset < 40; offset += 1) {
    const at = `0;0;${offset}`;
    editor.selection.select(at, at);
    const current = editor.selection.currentContentControl;
    const currentTag = current?.contentControlProperties?.tag ?? null;
    if (currentTag === tag) return;
  }
  throw new Error(`no caret position for ${tag}`);
}

describe('pasting into a bound field (plain-text content control)', () => {
  let editor: AnyEditor;
  let uninstall: () => void;

  beforeEach(() => {
    editor = makeRealDocumentEditor(
      docWith(
        para(textRun('Premium: '), taggedInline(PREMIUM, '$1.00'), textRun(' and '), taggedInline(TOTAL, '$3.00'), textRun(' end'))
      )
    );
    uninstall = installPasteGuard(editor);
  });

  afterEach(() => {
    uninstall();
    destroyRealDocumentEditor(editor);
  });

  it('pastes a copied field as its text, never a control inside the field', () => {
    placeCaret(editor, PREMIUM);
    editor.editorModule.paste(copiedControl(PREMIUM, '$8,918.00'));
    const sfdt = editor.serialize();

    expect(collectTags(JSON.parse(sfdt)).filter((tag) => tag === PREMIUM)).toHaveLength(1);
    expect(sfdt).toContain('$8,918.00');
  });

  it('pastes a copied formula into a formula as text, leaving one formula control', () => {
    placeCaret(editor, TOTAL);
    editor.editorModule.paste(copiedControl(TOTAL, '$3.00'));

    expect(collectTags(JSON.parse(editor.serialize())).filter((tag) => tag === TOTAL)).toHaveLength(1);
  });

  // The editor's own route for clipboard text, which parses it as JSON first
  it.each(['1500', '12.5', 'abc'])('pastes clipboard text %s into a field as typed', (text) => {
    placeCaret(editor, PREMIUM);
    editor.editorModule.beforePasteEvent(text, '.text');
    const sfdt = editor.serialize();

    expect(collectTags(JSON.parse(sfdt)).filter((tag) => tag === PREMIUM)).toHaveLength(1);
    expect(sfdt).toContain(text);
  });

  it('pastes a copied field outside any field as the control, as before', () => {
    placeCaret(editor, null);
    editor.editorModule.paste(copiedControl(PREMIUM, '$8,918.00'));

    expect(collectTags(JSON.parse(editor.serialize())).filter((tag) => tag === PREMIUM)).toHaveLength(2);
  });

  it('puts the original paste back when uninstalled', () => {
    uninstall();
    uninstall = () => undefined;
    placeCaret(editor, PREMIUM);
    editor.editorModule.paste(copiedControl(PREMIUM, '$8,918.00'));

    expect(collectTags(JSON.parse(editor.serialize())).filter((tag) => tag === PREMIUM).length).toBeGreaterThan(1);
  });
});

describe('pastedText', () => {
  it('reads text from full and optimized SFDT keys, in document order', () => {
    expect(pastedText({ sections: [{ blocks: [{ inlines: [{ text: '$8,' }, { contentControlProperties: {}, inlines: [{ text: '918.00' }] }] }] }] })).toBe('$8,918.00');
    expect(pastedText({ sec: [{ b: [{ i: [{ tlp: '$1' }, { ccp: {}, i: [{ tlp: '.00' }] }] }] }] })).toBe('$1.00');
  });
});
