import React, { useState } from 'react';
import Menu from '../Menu';
import { ChevronDownIcon } from '../../icons';
import { FONTS, FONT_SIZES } from '../../constants';
import { menuItem, textInput, triggerBtn, ZINC } from '../styles';

export default function FontGroup({
  editor,
  readOnly,
  fontFamily,
  fontSize,
  setFontSize
}: {
  editor: any;
  readOnly?: boolean;
  fontFamily: string;
  fontSize: number;
  setFontSize: (size: number) => void;
}) {
  const [fontQuery, setFontQuery] = useState('');
  const filteredFonts = FONTS.filter((f) =>
    f.toLowerCase().includes(fontQuery.toLowerCase())
  );

  return (
    <>
      <Menu
        onClose={() => setFontQuery('')}
        trigger={({ toggle }) => (
          <button
            type='button'
            css={{ ...triggerBtn, width: 128, justifyContent: 'space-between' }}
            onClick={toggle}
            disabled={readOnly}
          >
            <span
              css={{
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap'
              }}
              style={{ fontFamily }}
            >
              {fontFamily}
            </span>
            <ChevronDownIcon width={14} height={14} />
          </button>
        )}
      >
        {(close) => (
          <div css={{ width: 224 }}>
            <input
              css={{ ...textInput, marginBottom: 4 }}
              placeholder='Search fonts'
              value={fontQuery}
              autoFocus
              onChange={(e) => setFontQuery(e.target.value)}
              onKeyDown={(e) => e.stopPropagation()}
            />
            <div css={{ maxHeight: 284, overflowY: 'auto' }}>
              {filteredFonts.map((f) => (
                <button
                  type='button'
                  key={f}
                  css={{ ...menuItem(f === fontFamily), minHeight: 32 }}
                  style={{ fontFamily: f }}
                  onClick={() => {
                    editor.selection.characterFormat.fontFamily = f;
                    close();
                  }}
                >
                  {f}
                </button>
              ))}
              {filteredFonts.length === 0 && (
                <div
                  css={{ padding: '6px 8px', fontSize: 14, color: ZINC[400] }}
                >
                  No fonts
                </div>
              )}
            </div>
          </div>
        )}
      </Menu>
      <select
        css={{ ...triggerBtn, width: 64, cursor: 'pointer' }}
        value={fontSize}
        disabled={readOnly}
        onChange={(e) => {
          const size = Number(e.target.value);
          setFontSize(size);
          editor.selection.characterFormat.fontSize = size;
        }}
      >
        {(FONT_SIZES.includes(fontSize)
          ? FONT_SIZES
          : [...FONT_SIZES, fontSize].sort((a, b) => a - b)
        ).map((s) => (
          <option key={s} value={s}>
            {s}
          </option>
        ))}
      </select>
    </>
  );
}
