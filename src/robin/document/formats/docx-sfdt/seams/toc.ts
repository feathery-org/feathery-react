/**
 * The table of contents after a change set: the editor's own rebuild (`refreshTableOfContents`, the
 * editor code the review rail also calls), last in the commit and inside its undo group, reported as
 * the write's `toc` fact (only the live editor knows whether it rebuilt the contents). A rebuild that
 * failed halfway is reported with `failed`, so the commit takes its partial work back and lands the
 * change without it.
 */
import type { Fact } from '../../../envelope';
import { logWarn } from '../../../log';
import type { Seam, SeamReport } from '../../../pack';
import type { DocxHost } from '../host';
import {
  TocRefresh,
  refreshTableOfContents
} from '../../../../../elements/components/DocxEditor/toc/refreshToc';

export interface TocPayload {
  /**
   * `engine` when the commit replaced the document (the editor's history was cleared and the engine
   * keeps the way back): the rebuild's own undo entry is cleared with it.
   */
  history: 'editor' | 'engine';
  /** The contents' paragraphs in the intended document, for the fact. */
  ids?: string[];
}

/** The `toc` fact for what a refresh did. */
export function tocReport(ids: string[], outcome: TocRefresh): SeamReport {
  const summary =
    outcome.status === 'refreshed'
      ? `table of contents refreshed: ${outcome.entries} entries, ${outcome.added} added, ${outcome.removed} removed`
      : outcome.status === 'failed'
      ? `table of contents not refreshed: the editor's rebuild failed (${outcome.reason}); it stays as it is`
      : `table of contents not refreshed: ${outcome.reason}; it stays as it is`;
  if (outcome.status === 'failed')
    logWarn({ seam: 'toc', failed: outcome.reason });
  return {
    facts: [{ kind: 'finalizer', name: 'toc', ids, summary } as Fact],
    ...(outcome.status === 'failed' ? { failed: true } : {})
  };
}

export const tocSeam: Seam = {
  apply(host, payload) {
    const { editor } = host as DocxHost;
    const p = payload as TocPayload;
    return tocReport(
      p.ids ?? [],
      refreshTableOfContents(editor, { clearHistory: p.history === 'engine' })
    );
  }
};
