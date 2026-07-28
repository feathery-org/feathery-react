import React from 'react';
import { RedoIcon, UndoIcon } from '../../icons';
import { iconBtn } from '../styles';

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
        onClick={() => editor.editorHistory.undo()}
        title='Undo'
      >
        <UndoIcon width={16} height={16} />
      </button>
      <button
        type='button'
        css={iconBtn(false, readOnly)}
        disabled={readOnly}
        onClick={() => editor.editorHistory.redo()}
        title='Redo'
      >
        <RedoIcon width={16} height={16} />
      </button>
    </>
  );
}
