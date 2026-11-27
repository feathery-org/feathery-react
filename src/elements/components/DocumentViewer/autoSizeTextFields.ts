interface PdfAnnotation {
  id: string;
  fieldType?: string;
  multiLine?: boolean;
  comb?: boolean;
  defaultAppearanceData?: { fontSize: number };
}

export function fitAutoSizedTextFields(
  container: HTMLElement,
  annotations: readonly PdfAnnotation[]
) {
  const autoSizedIds = new Set(
    annotations
      .filter(
        (annotation) =>
          annotation.fieldType === 'Tx' &&
          !annotation.multiLine &&
          !annotation.comb &&
          annotation.defaultAppearanceData?.fontSize === 0
      )
      .map((annotation) => annotation.id)
  );
  const fields = Array.from(
    container.querySelectorAll<HTMLInputElement>('input[data-element-id]')
  )
    .filter((input) => autoSizedIds.has(input.dataset.elementId ?? ''))
    .map((input) => ({ input, fontSize: input.style.fontSize }));
  const view = container.ownerDocument.defaultView;
  if (!fields.length || !view) return () => {};
  const context = container.ownerDocument
    .createElement('canvas')
    .getContext('2d');
  if (!context) return () => {};

  // PDF.js treats automatic size (0) as a fixed default and only fits height.
  const fit = () => {
    for (const { input, fontSize } of fields) {
      input.style.fontSize = fontSize;
      const style = view.getComputedStyle(input);
      const width =
        input.clientWidth -
        parseFloat(style.paddingLeft) -
        parseFloat(style.paddingRight);
      context.font = style.font;
      const textWidth = context.measureText(input.value).width;
      if (width > 0 && textWidth > width) {
        input.style.fontSize = `${
          (parseFloat(style.fontSize) * width) / textWidth
        }px`;
      }
    }
  };
  fit();
  container.addEventListener('input', fit);
  return () => container.removeEventListener('input', fit);
}
