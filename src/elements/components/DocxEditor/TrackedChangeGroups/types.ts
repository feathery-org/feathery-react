import type { RevisionGroupIdentity } from '../../../../utils/documentEditorPrimitives';

/** One pending edit as the rail shows it. */
export interface ChipView {
  /** The chip's first revision - what focus, scroll and the active ring use. */
  revision: any;
  /** Everything the chip resolves; see `RevisionGroupItem.revisions`. */
  revisions?: any[];
  partner?: any;
  partnerRevisions?: any[];
  revisionType: string;
  text: string;
  beforeText?: string;
  author?: string;
}

export interface GroupView extends RevisionGroupIdentity {
  key: string;
  title: string;
  /** One author's manual edits rather than an assistant accept group. */
  untagged?: boolean;
  /** The group's author, shown once in the header. Omitted for untagged
   *  groups, where the title already IS the author name. */
  author?: string;
  chips: ChipView[];
}
