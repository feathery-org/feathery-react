import React from 'react';
import { BoldIcon, FontColorIcon, ItalicIcon, StrikeIcon } from '../../icons';
import { iconBtn } from '../styles';

export default function FormatGroup({
  editor,
  readOnly,
  bold,
  italic,
  strike,
  fontColor,
  setFontColor
}: {
  editor: any;
  readOnly?: boolean;
  bold: boolean;
  italic: boolean;
  strike: boolean;
  fontColor: string;
  setFontColor: (color: string) => void;
}) {
  return (
    <>
      <button
        type='button'
        css={iconBtn(bold, readOnly)}
        disabled={readOnly}
        onClick={() => editor.editor.toggleBold()}
        title='Bold'
      >
        <BoldIcon width={16} height={16} />
      </button>
      <button
        type='button'
        css={iconBtn(italic, readOnly)}
        disabled={readOnly}
        onClick={() => editor.editor.toggleItalic()}
        title='Italic'
      >
        <ItalicIcon width={16} height={16} />
      </button>
      <button
        type='button'
        css={iconBtn(strike, readOnly)}
        disabled={readOnly}
        onClick={() => editor.editor.toggleStrikethrough()}
        title='Strikethrough'
      >
        <StrikeIcon width={16} height={16} />
      </button>
      <label
        css={{ ...iconBtn(false, readOnly), position: 'relative' }}
        title='Text color'
      >
        <FontColorIcon width={16} height={16} />
        <span
          css={{
            position: 'absolute',
            bottom: 4,
            height: 2,
            width: 16,
            borderRadius: 2
          }}
          style={{ backgroundColor: fontColor }}
        />
        <input
          type='color'
          css={{
            position: 'absolute',
            width: 1,
            height: 1,
            opacity: 0,
            pointerEvents: 'none'
          }}
          value={fontColor}
          disabled={readOnly}
          onChange={(e) => {
            setFontColor(e.target.value);
            editor.selection.characterFormat.fontColor = e.target.value;
          }}
        />
      </label>
    </>
  );
}
