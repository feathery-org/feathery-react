import React, { useState } from 'react';
import { FEATHERY_RED, ZINC } from './styles';

// Word-style grid picker: hover to size, click to insert an R×C table.
export default function TableGridPicker({
  onPick
}: {
  onPick: (rows: number, cols: number) => void;
}) {
  const MAX = 8;
  const [hover, setHover] = useState({ r: 0, c: 0 });
  return (
    <div css={{ padding: 4 }} onMouseLeave={() => setHover({ r: 0, c: 0 })}>
      <div
        css={{
          display: 'grid',
          gridTemplateColumns: `repeat(${MAX}, 18px)`,
          gap: 2
        }}
      >
        {Array.from({ length: MAX * MAX }).map((_, i) => {
          const r = Math.floor(i / MAX);
          const c = i % MAX;
          const active = r <= hover.r && c <= hover.c;
          return (
            <div
              key={i}
              onMouseEnter={() => setHover({ r, c })}
              onClick={() => onPick(r + 1, c + 1)}
              css={{
                width: 18,
                height: 18,
                borderRadius: 2,
                cursor: 'pointer',
                border: `1px solid ${active ? FEATHERY_RED : ZINC[300]}`,
                background: active ? `${FEATHERY_RED}33` : '#fff'
              }}
            />
          );
        })}
      </div>
      <div
        css={{
          marginTop: 6,
          fontSize: 13,
          color: ZINC[700],
          textAlign: 'center'
        }}
      >
        {hover.r + 1} × {hover.c + 1}
      </div>
    </div>
  );
}
