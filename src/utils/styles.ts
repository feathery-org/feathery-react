export const FORM_Z_INDEX = 1;
export const DEV_NAV_BAR_Z_INDEX = FORM_Z_INDEX + 9;
export const MODAL_Z_INDEX = DEV_NAV_BAR_Z_INDEX + 9;

export function isDirectionColumn(flexDirection: any) {
  return flexDirection.includes('column');
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
