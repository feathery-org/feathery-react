import type { NormalForm } from '../../tree';
import { arr, entryOf } from './util';

type Obj = Record<string, unknown>;
const isObject = (v: unknown): v is Obj =>
  v !== null && typeof v === 'object' && !Array.isArray(v);

// Vendored, 34.1.31: `WParagraphFormat.getPropertyDefaultValue` for the natively set keys
const EDITOR_PARAGRAPH_DEFAULTS: Record<string, unknown> = {
  leftIndent: 0,
  rightIndent: 0,
  firstLineIndent: 0,
  beforeSpacing: 0,
  afterSpacing: 0,
  lineSpacing: 1,
  lineSpacingType: 'Multiple',
  textAlignment: 'Left',
  keepWithNext: false,
  keepLinesTogether: false,
  widowControl: true,
  contextualSpacing: false
};

export interface InheritedValue {
  value: unknown;
  from: 'style' | 'list' | 'default';
}

/** Reads a paragraph property as the editor resolves it: list level, named style (through `basedOn`), document default */
export function paragraphInheritance(
  nf: NormalForm
): (
  styleName: unknown,
  key: string,
  listFormat?: unknown
) => InheritedValue | undefined {
  const styles = new Map(
    arr<Obj>(nf.root.styles).map((s) => [String(s.name), s] as const)
  );
  const lists = new Map(arr<Obj>(nf.root.lists).map((l) => [l.listId, l]));
  const abstractLists = new Map(
    arr<Obj>(nf.root.abstractLists).map((a) => [a.abstractListId, a])
  );
  const levelFormat = (listFormat: unknown): Obj | null => {
    if (!isObject(listFormat) || Number(listFormat.listId ?? -1) < 0)
      return null;
    const list = lists.get(listFormat.listId);
    const level = arr<Obj>(abstractLists.get(list?.abstractListId)?.levels)[
      Number(listFormat.listLevelNumber ?? 0)
    ];
    return entryOf(nf, level?.paragraphFormat);
  };
  const documentDefault = entryOf(nf, nf.root.paragraphFormat) ?? {};
  return (styleName, key, listFormat) => {
    const own = isObject(listFormat) ? listFormat : {};
    const ownLevel = levelFormat(own);
    const fromOwnList =
      ownLevel && key in ownLevel
        ? { value: ownLevel[key], from: 'list' as const }
        : undefined;
    const seen = new Set<string>();
    let style = styles.get(String(styleName ?? 'Normal'));
    while (style && !seen.has(String(style.name))) {
      seen.add(String(style.name));
      const pf = entryOf(nf, style.paragraphFormat);
      if (pf && key in pf) {
        const styleList = isObject(pf.listFormat) ? pf.listFormat.listId : null;
        return fromOwnList && styleList !== own.listId
          ? fromOwnList
          : { value: pf[key], from: 'style' };
      }
      const styleLevel =
        own.listId === undefined && levelFormat(pf?.listFormat);
      if (styleLevel && key in styleLevel)
        return { value: styleLevel[key], from: 'list' };
      style = styles.get(String(style.basedOn));
    }
    if (fromOwnList) return fromOwnList;
    if (key in documentDefault)
      return { value: documentDefault[key], from: 'default' };
    return key in EDITOR_PARAGRAPH_DEFAULTS
      ? { value: EDITOR_PARAGRAPH_DEFAULTS[key], from: 'default' }
      : undefined;
  };
}
