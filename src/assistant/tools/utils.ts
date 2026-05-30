export type RepeatIndexFailure = {
  errorType:
    | 'repeated_index_missing'
    | 'repeated_index_out_of_range'
    | 'repeated_index_unexpected';
  error: string;
};

export function validateRepeatIndex(
  repeatIndex: number | null | undefined,
  inRepeat: boolean,
  rowCount: number,
  id: string
): RepeatIndexFailure | null {
  if (!inRepeat) {
    if (typeof repeatIndex === 'number') {
      return {
        errorType: 'repeated_index_unexpected',
        error: `'${id}' is not in a repeated container; do not pass repeatIndex.`
      };
    }
    return null;
  }
  if (typeof repeatIndex !== 'number') {
    const range =
      rowCount === 0 ? '(none yet - add a row first)' : `0..${rowCount - 1}`;
    return {
      errorType: 'repeated_index_missing',
      error: `'${id}' is in a repeated container; pass repeatIndex ${range}.`
    };
  }
  if (repeatIndex < 0 || repeatIndex >= rowCount) {
    return {
      errorType: 'repeated_index_out_of_range',
      error: `repeatIndex ${repeatIndex} is out of range for '${id}' (rowCount ${rowCount}).`
    };
  }
  return null;
}
