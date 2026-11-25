import { resolveColorAt } from '../core/render/color';
import { el } from '../core/opc/xml';
import type { OPCPackage } from '../core/opc/package';

const fill = (val: string, transforms: Record<string, string>) =>
  el('a:solidFill', undefined, [
    el(
      'a:srgbClr',
      { val },
      Object.entries(transforms).map(([tag, value]) =>
        el(`a:${tag}`, { val: value })
      )
    )
  ]);

const resolve = (node: ReturnType<typeof el>) =>
  resolveColorAt(node, {} as OPCPackage, undefined);

it('lightens a colour the way PowerPoint does, keeping its hue and saturation', () => {
  expect(resolve(fill('005D85', { lumMod: '20000', lumOff: '80000' }))).toBe(
    '#b4e8ff'
  );
});

it('darkens white to the same grey as before', () => {
  expect(resolve(fill('FFFFFF', { lumMod: '85000' }))).toBe('#d9d9d9');
});
