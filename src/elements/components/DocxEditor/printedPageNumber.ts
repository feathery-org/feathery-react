type Obj = Record<string, any>;

/** The number a laid-out page prints in its header or footer, or null when it prints none */
export function printedPageNumber(page: Obj, selection: Obj): number | null {
  const printsNumber = (widget: Obj | undefined): boolean =>
    !!widget &&
    ((widget.fieldType === 0 &&
      /^\s*PAGE\b/i.test(String(selection.getFieldCode(widget)))) ||
      [
        ...(widget.childWidgets ?? []),
        ...(widget.children ?? []),
        widget.textFrame
      ].some(printsNumber));
  return printsNumber(page.headerWidget) || printsNumber(page.footerWidget)
    ? (page.currentPageNum as number)
    : null;
}
