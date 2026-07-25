import React from 'react';
import Menu from '../Menu';
import {
  AlignCenterIcon,
  AlignJustifyIcon,
  AlignLeftIcon,
  AlignRightIcon,
  ChevronDownIcon
} from '../../icons';
import { iconBtn, triggerBtn } from '../styles';

const ALIGNMENTS = [
  { value: 'Left', Icon: AlignLeftIcon },
  { value: 'Center', Icon: AlignCenterIcon },
  { value: 'Right', Icon: AlignRightIcon },
  { value: 'Justify', Icon: AlignJustifyIcon }
] as const;

export default function AlignGroup({
  editor,
  readOnly,
  alignment
}: {
  editor: any;
  readOnly?: boolean;
  alignment: string;
}) {
  const AlignIcon =
    ALIGNMENTS.find((a) => a.value === alignment)?.Icon ?? AlignLeftIcon;
  return (
    <Menu
      trigger={({ toggle }) => (
        <button
          type='button'
          css={triggerBtn}
          onClick={toggle}
          title='Alignment'
          disabled={readOnly}
        >
          <AlignIcon width={16} height={16} />
          <ChevronDownIcon width={14} height={14} />
        </button>
      )}
    >
      {(close) => (
        <div css={{ display: 'flex', gap: 2 }}>
          {ALIGNMENTS.map(({ value, Icon }) => (
            <button
              type='button'
              key={value}
              css={iconBtn(value === alignment)}
              title={value}
              onClick={() => {
                editor.selection.paragraphFormat.textAlignment = value;
                close();
              }}
            >
              <Icon width={16} height={16} />
            </button>
          ))}
        </div>
      )}
    </Menu>
  );
}
