export const FORM_Z_INDEX = 1;
export const DEV_NAV_BAR_Z_INDEX = FORM_Z_INDEX + 9;
export const MODAL_Z_INDEX = DEV_NAV_BAR_Z_INDEX + 9;

// Callers reach this through apply(), which runs as soon as any of its keys is
// set -- so a theme that carries text_align but no flex_direction hands it
// undefined. Only the button tiers seed flex_direction today, which is the
// whole reason this has never thrown in production.
export function isDirectionColumn(flexDirection: any) {
  return typeof flexDirection === 'string' && flexDirection.includes('column');
}

export function adjustColor(color: string, amount: number) {
  return (
    '#' +
    color
      .replace(/^#/, '')
      .replace(/../g, (color) =>
        (
          '0' +
          Math.min(255, Math.max(0, parseInt(color, 16) + amount)).toString(16)
        ).substr(-2)
      )
  );
}
