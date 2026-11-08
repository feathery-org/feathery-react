// Robin's card table in a docx: written as a custom XML part on export, read back from the file on open
import { strFromU8, unzipSync } from 'fflate';
import {
  CARD_TABLE_NAMESPACE,
  CardTableEntry,
  cardTableXml,
  readCardTable
} from '../../../robin/document/cardTable';
import {
  cardAuthor,
  groupTag
} from '../../../robin/document/formats/docx-sfdt/adapter/revisions';
import {
  parseRevisionGroupTag,
  snapshotRevisions
} from '../../../utils/documentEditorPrimitives';

const CARD_TABLE_ITEM = '{5B0D2F6C-8E1A-4C3B-9D7E-6A4F1B2C3D4E}';

/** Put the cards of the editor's pending Robin revisions into the document's custom XML */
export function stampCardTable(editor: any): void {
  const data = editor?.documentHelper?.customXmlData;
  if (!data) return;
  const entries = new Map<string, CardTableEntry>();
  for (const revision of snapshotRevisions(editor)) {
    const tag = parseRevisionGroupTag(revision.customData);
    if (!tag || !revision.author || entries.has(revision.author)) continue;
    entries.set(revision.author, {
      key: revision.author,
      id: tag.changeSetId,
      ...(tag.title ? { title: tag.title } : {}),
      ...(tag.intent ? { intent: tag.intent } : {})
    });
  }
  if (data.containsKey(CARD_TABLE_ITEM)) data.remove(CARD_TABLE_ITEM);
  if (entries.size)
    data.add(CARD_TABLE_ITEM, cardTableXml([...entries.values()]));
}

/** The card table a docx file carries, or none */
export function cardTableIn(bytes: ArrayBuffer): CardTableEntry[] {
  try {
    const files = unzipSync(new Uint8Array(bytes), {
      filter: (file) => /^customXml\/item\d+\.xml$/.test(file.name)
    });
    for (const content of Object.values(files)) {
      const xml = strFromU8(content);
      if (!xml.includes(CARD_TABLE_NAMESPACE)) continue;
      const entries = readCardTable(xml);
      if (entries) return entries;
    }
  } catch {
    // A file that is not a readable zip has no card table
  }
  return [];
}

const CARD_ID = /^[\w-]{1,128}(\.\d+)?$/;

/** Give each reopened Robin revision its card back, matched by the author it was written under */
export function restoreCards(editor: any, entries: CardTableEntry[]): number {
  // A file's table is trusted only for Robin's own author of a well-formed card id
  const trusted = entries.filter(
    (entry) => CARD_ID.test(entry.id) && entry.key === cardAuthor(entry.id)
  );
  if (!trusted.length) return 0;
  const byKey = new Map(trusted.map((entry) => [entry.key, entry]));
  let restored = 0;
  for (const revision of snapshotRevisions(editor)) {
    const entry = revision.author ? byKey.get(revision.author) : undefined;
    if (!entry || parseRevisionGroupTag(revision.customData)) continue;
    revision.customData = groupTag(entry.id, {
      title: entry.title,
      intent: entry.intent
    });
    restored += 1;
  }
  return restored;
}
