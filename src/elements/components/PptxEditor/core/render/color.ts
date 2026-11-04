// Theme + color-map resolution: scheme colors resolve against the theme of a
// specific slide's master (decks can carry several), through its <p:clrMap>.
import {
  child,
  descendant,
  getAttr,
  root as xmlRoot,
  type ONode
} from '../opc/xml';
import { OPCPackage } from '../opc/package';

/** The conventional first theme part; the fallback when a master names none. */
export const DEFAULT_THEME_PART = 'ppt/theme/theme1.xml';

const DEFAULT_THEME_COLORS: Record<string, string> = {
  dk1: '000000',
  lt1: 'FFFFFF',
  dk2: '44546A',
  lt2: 'E7E6E6',
  accent1: '4472C4',
  accent2: 'ED7D31',
  accent3: 'A5A5A5',
  accent4: 'FFC000',
  accent5: '5B9BD5',
  accent6: '70AD47',
  hlink: '0563C1',
  folHlink: '954F72'
};
export const STANDARD_CLR_MAP: Record<string, string> = {
  bg1: 'lt1',
  tx1: 'dk1',
  bg2: 'lt2',
  tx2: 'dk2'
};
const THEME_SLOT_TAGS: Array<[string, string]> = [
  ['a:dk1', 'dk1'],
  ['a:lt1', 'lt1'],
  ['a:dk2', 'dk2'],
  ['a:lt2', 'lt2'],
  ['a:accent1', 'accent1'],
  ['a:accent2', 'accent2'],
  ['a:accent3', 'accent3'],
  ['a:accent4', 'accent4'],
  ['a:accent5', 'accent5'],
  ['a:accent6', 'accent6'],
  ['a:hlink', 'hlink'],
  ['a:folHlink', 'folHlink']
];

// Per-package caches: a theme part / slide path means a different thing in a
// different deck, so never key these globally.
const themeCache = new WeakMap<
  OPCPackage,
  Map<string, Record<string, string>>
>();
const themePartCache = new WeakMap<OPCPackage, Map<string, string>>();
const clrMapCache = new WeakMap<
  OPCPackage,
  Map<string, Record<string, string>>
>();
export function pkgCache<V>(
  m: WeakMap<OPCPackage, Map<string, V>>,
  pkg: OPCPackage
) {
  let inner = m.get(pkg);
  if (!inner) {
    inner = new Map<string, V>();
    m.set(pkg, inner);
  }
  return inner;
}

/** Theme colors keyed by real slot (dk1/lt1/dk2/lt2/accentN/hlink/folHlink). */
export function themeColors(
  pkg: OPCPackage,
  themePart = DEFAULT_THEME_PART
): Record<string, string> {
  const inner = pkgCache(themeCache, pkg);
  const cached = inner.get(themePart);
  if (cached) return cached;
  const map = { ...DEFAULT_THEME_COLORS };
  try {
    if (pkg.hasPart(themePart)) {
      const root = pkg
        .tree(themePart)
        .find((n) => Object.keys(n).some((k) => k.endsWith('theme')));
      const scheme = root && descendant(root, 'a:clrScheme');
      if (scheme) {
        for (const [tag, slot] of THEME_SLOT_TAGS) {
          const n = child(scheme, tag);
          if (!n) continue;
          const srgb = child(n, 'a:srgbClr');
          const sys = child(n, 'a:sysClr');
          // sysClr @val is a system-color NAME (e.g. "window"); hex is @lastClr
          const val = srgb
            ? getAttr(srgb, 'val')
            : sys
            ? getAttr(sys, 'lastClr') || getAttr(sys, 'val')
            : undefined;
          if (val) map[slot] = val.toUpperCase();
        }
      }
    }
  } catch {
    /* keep defaults */
  }
  inner.set(themePart, map);
  return map;
}

/** Theme part feeding the slide's master (falls back to theme1). */
export function themePartForSlide(
  pkg: OPCPackage,
  slidePath: string | undefined
): string {
  if (!slidePath) return DEFAULT_THEME_PART;
  const inner = pkgCache(themePartCache, pkg);
  const cached = inner.get(slidePath);
  if (cached) return cached;
  const layout = pkg.layoutFor(slidePath);
  const master = layout && pkg.masterFor(layout);
  const theme =
    (master && pkg.relTargetByType(master, 'theme')) || DEFAULT_THEME_PART;
  inner.set(slidePath, theme);
  return theme;
}

/** The slide master's <p:clrMap> (bg1/bg2/tx1/tx2 -> real theme slot). */
export function clrMapForSlide(
  pkg: OPCPackage,
  slidePath: string | undefined
): Record<string, string> {
  if (!slidePath) return STANDARD_CLR_MAP;
  const inner = pkgCache(clrMapCache, pkg);
  const cached = inner.get(slidePath);
  if (cached) return cached;
  let map = STANDARD_CLR_MAP;
  const layout = pkg.layoutFor(slidePath);
  const master = layout && pkg.masterFor(layout);
  if (master && pkg.hasPart(master)) {
    const clrMap = child(xmlRoot(pkg.tree(master)), 'p:clrMap');
    if (clrMap) {
      map = {
        bg1: getAttr(clrMap, 'bg1') || 'lt1',
        tx1: getAttr(clrMap, 'tx1') || 'dk1',
        bg2: getAttr(clrMap, 'bg2') || 'lt2',
        tx2: getAttr(clrMap, 'tx2') || 'dk2'
      };
    }
  }
  inner.set(slidePath, map);
  return map;
}

/** Hex (no '#') for a schemeClr val, honoring the slide's clrMap + theme. */
export function schemeColorHexAt(
  name: string,
  pkg: OPCPackage,
  slidePath: string | undefined
): string | undefined {
  // bg1/bg2/tx1/tx2 map via clrMap; the rest name a theme slot directly.
  const slot = STANDARD_CLR_MAP[name]
    ? clrMapForSlide(pkg, slidePath)[name] || STANDARD_CLR_MAP[name]
    : name;
  return themeColors(pkg, themePartForSlide(pkg, slidePath))[slot];
}

/** Resolve a solidFill/color container to '#hex', applying lumMod/lumOff/shade/tint;
 *  phClr substitutes a theme placeholder color when schemeClr val="phClr". */
export function resolveColorAt(
  colorParent: ONode | undefined,
  pkg: OPCPackage,
  slidePath: string | undefined,
  phClr?: string
): string | undefined {
  if (!colorParent) return undefined;
  const srgb = child(colorParent, 'a:srgbClr');
  const scheme = child(colorParent, 'a:schemeClr');
  const sys = child(colorParent, 'a:sysClr');
  let hex: string | undefined;
  let node: ONode | undefined;
  if (srgb) {
    hex = getAttr(srgb, 'val');
    node = srgb;
  } else if (scheme) {
    const name = getAttr(scheme, 'val') || 'tx1';
    hex =
      name === 'phClr' && phClr
        ? phClr.replace('#', '')
        : schemeColorHexAt(name, pkg, slidePath);
    node = scheme;
  } else if (sys) {
    hex = getAttr(sys, 'lastClr') || getAttr(sys, 'val');
    node = sys;
  }
  if (!hex) return undefined;
  hex = hex.replace('#', '');
  const mod = node && child(node, 'a:lumMod');
  const off = node && child(node, 'a:lumOff');
  const shade = node && child(node, 'a:shade');
  const tint = node && child(node, 'a:tint');
  const pct = (n: ONode | undefined) =>
    n ? Number(getAttr(n, 'val')) / 100000 : undefined;
  let [r, g, b] = [0, 2, 4].map((i) => parseInt(hex!.slice(i, i + 2), 16));
  const clamp = (v: number) => Math.max(0, Math.min(255, Math.round(v)));
  const lm = pct(mod);
  const lo = pct(off);
  const sh = pct(shade);
  const tn = pct(tint);
  if (lm !== undefined) {
    r *= lm;
    g *= lm;
    b *= lm;
  }
  if (lo !== undefined) {
    r += 255 * lo;
    g += 255 * lo;
    b += 255 * lo;
  }
  if (sh !== undefined) {
    r *= sh;
    g *= sh;
    b *= sh;
  }
  if (tn !== undefined) {
    r = r * tn + 255 * (1 - tn);
    g = g * tn + 255 * (1 - tn);
    b = b * tn + 255 * (1 - tn);
  }
  return (
    '#' + [r, g, b].map((v) => clamp(v).toString(16).padStart(2, '0')).join('')
  );
}
