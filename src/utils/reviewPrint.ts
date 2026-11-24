// Print from the Generate Documents review screen. The print code and pdf.js
// load on demand, like the viewer, to stay out of the main bundle.

type Printer = (urls: string[]) => Promise<void>;

export const PRINT_LOAD_ERROR = {
  status: 'error',
  message: 'Unable to load printing. Please try again.'
} as const;
export const PRINT_NO_FILES_ERROR = {
  status: 'error',
  message: 'There are no documents to print.'
} as const;
export const PRINT_FAILED_ERROR = {
  status: 'error',
  message: 'Unable to print the documents. Please try again.'
} as const;

/** Load the printer before finalizing, so a blocked load fails before the
 * envelopes are finalized (and, with merge_docs, merged) on every retry.
 * Resolves null when the print code or pdf.js can't load. */
export const loadReviewPrinter = (): Promise<Printer | null> =>
  import('../elements/components/DocumentViewer/print')
    .then((module) => module.loadPrinter())
    .catch((e: unknown) => {
      console.warn('Unable to load printing', e);
      return null;
    });

// The same stored file signed twice differs only in its query string.
const withoutQuery = (url: string) => url.split(/[?#]/)[0];

/** Print a finalized review's files, leaving out `unprintableFiles` (the
 * attachments shown as file cards). Resolves to an error result for the
 * review screen to show instead of throwing, or null once printing starts. */
export async function printFinalizedFiles(
  printer: Printer,
  files: string[] = [],
  unprintableFiles: string[] = []
) {
  const skipped = new Set(unprintableFiles.map(withoutQuery));
  const printable = files.filter((file) => !skipped.has(withoutQuery(file)));
  if (!printable.length) return PRINT_NO_FILES_ERROR;
  try {
    await printer(printable);
    return null;
  } catch (e) {
    console.warn('Unable to print the documents', e);
    return PRINT_FAILED_ERROR;
  }
}
