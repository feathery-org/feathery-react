import type { ListStyle } from '../../envelope';
import type { DocumentView } from '../../pack';
import { arr, entryOf } from './util';

type Obj = Record<string, unknown>;
const isObject = (v: unknown): v is Obj =>
  v !== null && typeof v === 'object' && !Array.isArray(v);

/** The document's paragraph styles that make a paragraph a list item, and the look of each */
export function listStyles(view: DocumentView): ListStyle[] {
  const { root } = view.nf;
  const lists = new Map(arr<Obj>(root.lists).map((l) => [l.listId, l]));
  const abstractLists = new Map(
    arr<Obj>(root.abstractLists).map((a) => [a.abstractListId, a])
  );
  return arr<Obj>(root.styles).flatMap((style) => {
    const format = entryOf(view.nf, style.paragraphFormat)?.listFormat;
    if (!isObject(format)) return [];
    const list = lists.get(format.listId);
    if (!list) return [];
    const level = arr<Obj>(abstractLists.get(list.abstractListId)?.levels)[
      Number(format.listLevelNumber ?? 0)
    ];
    const look: ListStyle['look'] =
      level?.listLevelPattern === 'Bullet' ? 'bullet' : 'numbered';
    return [{ name: String(style.name), listId: Number(list.listId), look }];
  });
}
