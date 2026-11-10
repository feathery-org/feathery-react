/** Robin's card table, saved in the document file so cards keep their ids and intents across a reopen */
export const CARD_TABLE_NAMESPACE = 'urn:feathery:robin:cards:1';

export interface CardTableEntry {
  key: string;
  id: string;
  title?: string;
  intent?: string;
}

// eslint-disable-next-line no-control-regex
const NOT_XML = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]/g;

const escapeXml = (value: string) =>
  value
    .replace(NOT_XML, '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/\t/g, '&#9;')
    .replace(/\n/g, '&#10;')
    .replace(/\r/g, '&#13;');

export function cardTableXml(entries: CardTableEntry[]): string {
  const cards = entries.map((entry) => {
    const attributes = Object.entries(entry)
      .filter(([, value]) => typeof value === 'string' && value)
      .map(([name, value]) => `${name}="${escapeXml(value as string)}"`);
    return `<card ${attributes.join(' ')}/>`;
  });
  return `<?xml version="1.0" encoding="UTF-8"?><cards xmlns="${CARD_TABLE_NAMESPACE}">${cards.join(
    ''
  )}</cards>`;
}

/** The entries of a card table, or null when the XML is not one */
export function readCardTable(xml: string): CardTableEntry[] | null {
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  const root = doc.documentElement;
  if (root?.namespaceURI !== CARD_TABLE_NAMESPACE || root.localName !== 'cards')
    return null;
  const entries: CardTableEntry[] = [];
  for (const card of Array.from(
    root.getElementsByTagNameNS(CARD_TABLE_NAMESPACE, 'card')
  )) {
    const key = card.getAttribute('key');
    const id = card.getAttribute('id');
    if (!key || !id) continue;
    const title = card.getAttribute('title');
    const intent = card.getAttribute('intent');
    entries.push({
      key,
      id,
      ...(title ? { title } : {}),
      ...(intent ? { intent } : {})
    });
  }
  return entries;
}
