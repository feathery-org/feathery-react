/** Each body paragraph at the position the editor numbers it, the one numbering reads and writes share */
import type { DocumentView } from '../../pack';
import type { NfNode } from '../../tree';
import { KIND } from './adapter/keys';
import { arr } from './util';

type EditorParagraph = {
  paragraph: NfNode;
  position: string;
  opensControl: boolean;
  inControl: boolean;
};

const numbered = new WeakMap<DocumentView, Map<string, EditorParagraph>>();

/** The editor counts a block control's blocks in the list holding it and gives the paragraph it opens on one extra position */
export function editorParagraphs(
  view: DocumentView
): Map<string, EditorParagraph> {
  const known = numbered.get(view);
  if (known) return known;
  const byId = new Map<string, EditorParagraph>();
  const numberBlocks = (
    blocks: NfNode[],
    at: string,
    opens: boolean,
    inControl: boolean
  ) => {
    let index = 0;
    const visit = (block: NfNode, opensControl: boolean, inside: boolean) => {
      if (block.kind === KIND.control) {
        arr<NfNode>(block.blocks).forEach((b, i) => visit(b, i === 0, true));
        return;
      }
      const position = `${at}${index}`;
      index += 1;
      if (block.kind === KIND.paragraph)
        byId.set(block.id, {
          paragraph: block,
          position,
          opensControl,
          inControl: inside
        });
      arr<NfNode>(block.rows).forEach((row, r) =>
        arr<NfNode>(row.cells).forEach((cell, c) =>
          numberBlocks(
            arr<NfNode>(cell.blocks),
            `${position};${r};${c};`,
            opensControl && r === 0 && c === 0,
            inside
          )
        )
      );
    };
    blocks.forEach((block, i) => visit(block, opens && i === 0, inControl));
  };
  arr<NfNode>(view.nf.root.sections).forEach((section, s) =>
    numberBlocks(arr<NfNode>(section.blocks), `${s};`, false, false)
  );
  numbered.set(view, byId);
  return byId;
}
