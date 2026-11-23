// Match Tasks: keep leading tabs and pin an overflowing selection into the last slot.
export function visibleDocumentTabs(
  widths: number[],
  available: number,
  activeIndex: number,
  triggerWidth: number
): number[] {
  const indices = widths.map((_, index) => index);
  if (widths.reduce((sum, width) => sum + width, 0) <= available - 8)
    return indices;
  const budget = Math.max(0, available - triggerWidth - 8);
  let count = 0;
  let used = 0;
  for (const width of widths) {
    if (count && used + width > budget) break;
    used += width;
    count++;
  }
  const pinned = (size: number) => {
    const result = indices.slice(0, size);
    if (activeIndex >= size && activeIndex < widths.length)
      result[result.length - 1] = activeIndex;
    return result;
  };
  while (
    count > 1 &&
    pinned(count).reduce((sum, i) => sum + widths[i], 0) > budget
  )
    count--;
  return pinned(count);
}
