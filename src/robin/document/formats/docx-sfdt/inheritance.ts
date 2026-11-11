import type { NormalForm } from '../../tree';
import { arr, entryOf } from './util';

type Obj = Record<string, unknown>;

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
  from: 'style' | 'default';
}

/** Reads a paragraph property as a named style gives it (through `basedOn`), else the document's default, else the editor's */
export function paragraphInheritance(
  nf: NormalForm
): (styleName: unknown, key: string) => InheritedValue | undefined {
  const styles = new Map(
    arr<Obj>(nf.root.styles).map((s) => [String(s.name), s] as const)
  );
  const documentDefault = entryOf(nf, nf.root.paragraphFormat) ?? {};
  return (styleName, key) => {
    const seen = new Set<string>();
    let style = styles.get(String(styleName ?? 'Normal'));
    while (style && !seen.has(String(style.name))) {
      seen.add(String(style.name));
      const pf = entryOf(nf, style.paragraphFormat);
      if (pf && key in pf) return { value: pf[key], from: 'style' };
      style = styles.get(String(style.basedOn));
    }
    if (key in documentDefault)
      return { value: documentDefault[key], from: 'default' };
    return key in EDITOR_PARAGRAPH_DEFAULTS
      ? { value: EDITOR_PARAGRAPH_DEFAULTS[key], from: 'default' }
      : undefined;
  };
}
