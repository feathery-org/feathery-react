import React from 'react';
import { RedoIcon, UndoIcon } from '../../icons';
import { iconBtn } from '../styles';
import { redoDocument, undoDocument } from '../../historyRouting';

export default function HistoryGroup({
  editor,
  readOnly
}: {
  editor: any;
  readOnly?: boolean;
}) {
  return (
    <>
      <button
        type='button'
        css={iconBtn(false, readOnly)}
        disabled={readOnly}
        onClick={() => undoDocument(editor)}
        title='Undo'
      >
        <UndoIcon width={16} height={16} />
      </button>
      <button
        type='button'
        css={iconBtn(false, readOnly)}
        disabled={readOnly}
        onClick={() => redoDocument(editor)}
        title='Redo'
      >
        <RedoIcon width={16} height={16} />
      </button>
    </>
  );
}
