import { strToU8, zipSync } from 'fflate';
import { cardTableXml, readCardTable } from '../../../robin/document/cardTable';
import {
  cardAuthor,
  groupTag
} from '../../../robin/document/formats/docx-sfdt/adapter/revisions';
import { cardTableIn, restoreCards, stampCardTable } from './robinCardTable';

class Dictionary {
  map = new Map<string, string>();
  containsKey = (key: string) => this.map.has(key);
  remove = (key: string) => this.map.delete(key);
  add = (key: string, value: string) => this.map.set(key, value);
}

const ONE = cardAuthor('card-one');

const editorWith = (
  revisions: Array<{ author: string; customData?: string | null }>
) => ({
  revisions: { changes: revisions },
  documentHelper: { customXmlData: new Dictionary() }
});

describe("Robin's card table in a docx (Hilb post-v9 G1)", () => {
  it('reads back the cards it writes, text with markup characters included', () => {
    const entries = [
      {
        key: 'Robin⁠⁡',
        id: 'a1b2c3d4e5',
        title: 'Premium <columns>',
        intent: 'Remove "premium" & keep the word'
      },
      { key: 'Robin⁡⁡', id: 'a1b2c3d4e5.2' }
    ];

    expect(readCardTable(cardTableXml(entries))).toEqual(entries);
    expect(readCardTable('<other xmlns="urn:someone"/>')).toBeNull();
  });

  it('keeps every card when an intent holds characters XML cannot carry, and keeps its line breaks', () => {
    const entries = [
      {
        key: 'Robin⁠',
        id: 'card-one',
        intent: 'Remove\u0001 the\uFFFE lines\nthen\ttotal'
      },
      { key: 'Robin⁡', id: 'card-two' }
    ];

    expect(readCardTable(cardTableXml(entries))).toEqual([
      {
        key: 'Robin⁠',
        id: 'card-one',
        intent: 'Remove the lines\nthen\ttotal'
      },
      { key: 'Robin⁡', id: 'card-two' }
    ]);
  });

  it('carries the cards through export and a reopen that dropped every revision tag', () => {
    const exporting = editorWith([
      {
        author: ONE,
        customData: groupTag('card-one', {
          title: 'Delete',
          intent: 'Remove the premiums'
        })
      },
      {
        author: ONE,
        customData: groupTag('card-one', {
          title: 'Delete',
          intent: 'Remove the premiums'
        })
      },
      { author: 'Ann' }
    ]);
    stampCardTable(exporting);
    const [xml] = [...exporting.documentHelper.customXmlData.map.values()];
    const docx = zipSync({
      'word/document.xml': strToU8('<w:document/>'),
      'customXml/item1.xml': strToU8(xml)
    });

    const reopened = editorWith([
      { author: ONE, customData: null },
      { author: 'Ann', customData: null }
    ]);
    expect(
      restoreCards(reopened, cardTableIn(docx.buffer as ArrayBuffer))
    ).toBe(1);

    expect(
      JSON.parse(String(reopened.revisions.changes[0].customData))
    ).toMatchObject({ changeSetId: 'card-one', intent: 'Remove the premiums' });
    expect(reopened.revisions.changes[1].customData).toBeNull();
  });

  it("restores only entries carrying Robin's own author for a well-formed card id", () => {
    const reopened = editorWith([
      { author: 'Jane Doe', customData: null },
      { author: cardAuthor('</cards>'), customData: null },
      { author: ONE, customData: null }
    ]);

    expect(
      restoreCards(reopened, [
        { key: 'Jane Doe', id: 'card-one' },
        { key: cardAuthor('</cards>'), id: '</cards>' },
        { key: ONE, id: 'card-one' }
      ])
    ).toBe(1);
    expect(reopened.revisions.changes[0].customData).toBeNull();
    expect(reopened.revisions.changes[1].customData).toBeNull();
  });

  it('removes the card table when no Robin card is pending', () => {
    const editor = editorWith([
      { author: 'Robin⁠', customData: groupTag('card-one') }
    ]);
    stampCardTable(editor);
    editor.revisions.changes = [];
    stampCardTable(editor);

    expect(editor.documentHelper.customXmlData.map.size).toBe(0);
  });
});
