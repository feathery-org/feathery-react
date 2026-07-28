import React from 'react';
import Menu from '../Menu';
import TableGridPicker from '../TableGridPicker';
import { InsertImageIcon, LinkIcon, TableIcon } from '../../icons';
import { iconBtn } from '../styles';
import { featheryWindow } from '../../../../../utils/browser';

export default function InsertGroup({
  editor,
  readOnly,
  onPickImage
}: {
  editor: any;
  readOnly?: boolean;
  /** Opens the toolbar's (single, hoisted) hidden file input. */
  onPickImage: () => void;
}) {
  const insertLink = () => {
    const url = featheryWindow().prompt('Link URL');
    if (url) editor.editor.insertHyperlink(url, editor.selection.text || url);
  };

  return (
    <>
      <button
        type='button'
        css={iconBtn(false, readOnly)}
        disabled={readOnly}
        onClick={insertLink}
        title='Insert link'
      >
        <LinkIcon width={16} height={16} />
      </button>
      <button
        type='button'
        css={iconBtn(false, readOnly)}
        disabled={readOnly}
        onClick={onPickImage}
        title='Insert image'
      >
        <InsertImageIcon width={16} height={16} />
      </button>
      <Menu
        trigger={({ toggle }) => (
          <button
            type='button'
            css={iconBtn(false, readOnly)}
            disabled={readOnly}
            onClick={toggle}
            title='Insert table'
          >
            <TableIcon width={16} height={16} />
          </button>
        )}
      >
        {(close) => (
          <TableGridPicker
            onPick={(rows, cols) => {
              editor.editor.insertTable(rows, cols);
              close();
            }}
          />
        )}
      </Menu>
    </>
  );
}
