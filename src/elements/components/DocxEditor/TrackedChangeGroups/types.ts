/** One pending edit as the rail shows it. */
export interface ChipView {
  revision: any;
  partner?: any;
  revisionType: string;
  text: string;
  beforeText?: string;
  author?: string;
}

export interface GroupView {
  key: string;
  title: string;
  /** One author's manual edits rather than an assistant accept group. */
  untagged?: boolean;
  chips: ChipView[];
}
