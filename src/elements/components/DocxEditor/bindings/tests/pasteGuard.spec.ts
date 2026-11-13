import {
  collectTags,
  destroyRealDocumentEditor,
  docWith,
  makeRealDocumentEditor,
  cellText,
  para,
  row,
  table,
  taggedInline,
  textRun
} from './realEditorHarness';
import { installPasteGuard } from '../pasteGuard';

type AnyEditor = any;

const PREMIUM = '[[name=premium|type=currency]]';
const TOTAL = '[[name=total|type=currency|expr=sum(1,2)]]';

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

/** A clipboard paste as the browser delivers it: the copied document plus its plain text */
function pasteClipboard(editor: AnyEditor, copied: object | null, text: string): void {
  const data: Record<string, string> = { 'application/json': copied ? JSON.stringify(copied) : '', Text: text };
  editor.editorModule.pasteInternal({ clipboardData: { getData: (type: string) => data[type] ?? '' } });
}

const premiumTags = (editor: AnyEditor) =>
  collectTags(JSON.parse(editor.serialize())).filter((tag) => tag === PREMIUM);

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
    pasteClipboard(editor, docWith(para(taggedInline(PREMIUM, '$8,918.00'))), '$8,918.00');

    expect(premiumTags(editor)).toHaveLength(1);
    expect(editor.serialize()).toContain('$8,918.00');
  });

  it('pastes a copied formula into a formula as text, leaving one formula control', () => {
    placeCaret(editor, TOTAL);
    pasteClipboard(editor, docWith(para(taggedInline(TOTAL, '$3.00'))), '$3.00');

    expect(collectTags(JSON.parse(editor.serialize())).filter((tag) => tag === TOTAL)).toHaveLength(1);
  });

  it('pastes a copied table into a field as one line of its text, never a table inside the field', () => {
    placeCaret(editor, PREMIUM);
    pasteClipboard(editor, docWith(table(row(cellText('$9,'), cellText('100.00')))), '$9,\r\n100.00\r\n');
    const sfdt = editor.serialize();

    expect(premiumTags(editor)).toHaveLength(1);
    expect(sfdt).toContain('$9,100.00');
    expect(editor.documentHelper.pages[0].bodyWidgets[0].childWidgets).toHaveLength(1);
  });

  it('pastes a copied link into a field as the text it shows, never a live link or its code', () => {
    placeCaret(editor, PREMIUM);
    const link = [
      { fieldType: 0, hasFieldEnd: true },
      textRun('HYPERLINK "https://example.com"'),
      { fieldType: 2 },
      textRun('$5.00'),
      { fieldType: 1 }
    ];
    pasteClipboard(editor, docWith(para(...link)), '$5.00');
    const sfdt = editor.serialize();

    expect(premiumTags(editor)).toHaveLength(1);
    expect(sfdt).toContain('$5.00');
    expect(sfdt).not.toContain('example.com');
  });

  it("pastes commented words into a field without the comment's own text", () => {
    placeCaret(editor, PREMIUM);
    const commented = { ...docWith(para(textRun('$7.00'))), comments: [{ commentId: 'c1', author: 'Ann', blocks: [para(textRun('Check this figure'))] }] };
    pasteClipboard(editor, commented, '$7.00');
    const sfdt = editor.serialize();

    expect(sfdt).toContain('$7.00');
    expect(sfdt).not.toContain('Check this figure');
  });

  it('pastes nothing into a field when the copy has no text, such as an image', () => {
    placeCaret(editor, PREMIUM);
    pasteClipboard(editor, docWith(para({ imageString: 'data:image/png;base64,iVBORw0KGgo=', width: 10, height: 10 })), '');

    expect(premiumTags(editor)).toHaveLength(1);
    expect(editor.serialize()).not.toContain('imageString');
  });

  // The editor's own route for clipboard text, which parses it as JSON first
  it.each(['1500', '12.5', 'abc'])('pastes clipboard text %s into a field as typed', (text) => {
    placeCaret(editor, PREMIUM);
    pasteClipboard(editor, null, text);
    const sfdt = editor.serialize();

    expect(premiumTags(editor)).toHaveLength(1);
    expect(sfdt).toContain(text);
  });

  it('leaves a paste the editor is handed directly as it is, never an earlier clipboard text', () => {
    placeCaret(editor, null);
    pasteClipboard(editor, null, 'OLDCLIP');
    placeCaret(editor, PREMIUM);
    editor.editorModule.paste(JSON.stringify(docWith(para(textRun('NEWDOC')))));
    const sfdt = editor.serialize();

    expect(sfdt).toContain('NEWDOC');
    expect(sfdt.split('OLDCLIP')).toHaveLength(2);
  });

  it('pastes a copied field outside any field as the control, as before', () => {
    placeCaret(editor, null);
    pasteClipboard(editor, docWith(para(taggedInline(PREMIUM, '$8,918.00'))), '$8,918.00');

    expect(premiumTags(editor)).toHaveLength(2);
  });

  it('puts the original paste back when uninstalled', () => {
    uninstall();
    uninstall = () => undefined;
    placeCaret(editor, PREMIUM);
    pasteClipboard(editor, docWith(para(taggedInline(PREMIUM, '$8,918.00'))), '$8,918.00');

    expect(premiumTags(editor).length).toBeGreaterThan(1);
  });
});
