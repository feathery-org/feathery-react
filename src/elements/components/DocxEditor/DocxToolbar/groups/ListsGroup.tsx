import React from 'react';
import { BulletListIcon, NumberListIcon } from '../../icons';
import { iconBtn } from '../styles';

export default function ListsGroup({
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
        onClick={() => editor.editor.applyBullet('', 'Symbol')}
        title='Bullet list'
      >
        <BulletListIcon width={16} height={16} />
      </button>
      <button
        type='button'
        css={iconBtn(false, readOnly)}
        disabled={readOnly}
        onClick={() => editor.editor.applyNumbering('%1.', 'Arabic')}
        title='Numbered list'
      >
        <NumberListIcon width={16} height={16} />
      </button>
    </>
  );
}
