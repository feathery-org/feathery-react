import React from 'react';
import Menu from '../Menu';
import {
  ChevronDownIcon,
  HeadingOneIcon,
  HeadingThreeIcon,
  HeadingTwoIcon,
  TextIcon
} from '../../icons';
import { menuItem, triggerBtn } from '../styles';

const STYLES = [
  { label: 'Text', value: 'Normal', Icon: TextIcon },
  { label: 'Heading 1', value: 'Heading 1', Icon: HeadingOneIcon },
  { label: 'Heading 2', value: 'Heading 2', Icon: HeadingTwoIcon },
  { label: 'Heading 3', value: 'Heading 3', Icon: HeadingThreeIcon }
];

export default function StyleGroup({
  editor,
  readOnly,
  styleName
}: {
  editor: any;
  readOnly?: boolean;
  styleName: string;
}) {
  const StyleIcon = STYLES.find((s) => s.value === styleName)?.Icon ?? TextIcon;
  return (
    <Menu
      trigger={({ toggle }) => (
        <button
          type='button'
          css={triggerBtn}
          onClick={toggle}
          title='Text style'
          disabled={readOnly}
        >
          <StyleIcon width={16} height={16} />
          <ChevronDownIcon width={14} height={14} />
        </button>
      )}
    >
      {(close) => (
        <div css={{ width: 176 }}>
          {STYLES.map(({ label, value, Icon }) => (
            <button
              type='button'
              key={value}
              css={menuItem(value === styleName)}
              onClick={() => {
                editor.editor.applyStyle(value, true);
                close();
              }}
            >
              <Icon width={16} height={16} />
              {label}
            </button>
          ))}
        </div>
      )}
    </Menu>
  );
}
