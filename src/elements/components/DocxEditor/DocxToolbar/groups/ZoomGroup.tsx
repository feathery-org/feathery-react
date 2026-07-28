import React, { useEffect, useState } from 'react';
import Menu from '../Menu';
import { FitToPageIcon, MinusIcon, PlusIcon } from '../../icons';
import { ZOOM_PRESETS } from '../../constants';
import { iconBtn, menuItem, textInput, triggerBtn, ZINC } from '../styles';

export default function ZoomGroup({
  editor,
  zoom,
  applyZoom,
  refreshZoom
}: {
  editor: any;
  zoom: number;
  applyZoom: (pct: number) => void;
  refreshZoom: () => void;
}) {
  const [zoomInput, setZoomInput] = useState(String(zoom));
  // Keep the free-form input tracking the actual zoom (buttons, presets,
  // fitPage, editor-driven changes).
  useEffect(() => setZoomInput(String(zoom)), [zoom]);

  return (
    <>
      <button
        type='button'
        css={iconBtn()}
        onClick={() => applyZoom(zoom - 10)}
        title='Zoom out'
      >
        <MinusIcon width={16} height={16} />
      </button>
      <Menu
        align='center'
        onClose={() => setZoomInput(String(zoom))}
        trigger={({ toggle }) => (
          <button
            type='button'
            css={{
              ...triggerBtn,
              width: 56,
              justifyContent: 'center',
              fontVariantNumeric: 'tabular-nums'
            }}
            onClick={toggle}
          >
            {zoom}%
          </button>
        )}
      >
        {(close) => (
          <div css={{ width: 176 }}>
            <input
              css={{ ...textInput, marginBottom: 4 }}
              value={zoomInput}
              autoFocus
              onChange={(e) => setZoomInput(e.target.value)}
              onKeyDown={(e) => {
                e.stopPropagation();
                if (e.key === 'Enter') {
                  const pct = parseInt(zoomInput, 10);
                  if (Number.isFinite(pct)) applyZoom(pct);
                  close();
                }
              }}
            />
            <button
              type='button'
              css={menuItem()}
              onClick={() => {
                editor.fitPage('FitPageWidth');
                refreshZoom();
                close();
              }}
            >
              <FitToPageIcon width={16} height={16} />
              Fit to page
            </button>
            <div css={{ margin: '4px 0', height: 1, background: ZINC[200] }} />
            {ZOOM_PRESETS.map((p) => (
              <button
                type='button'
                key={p}
                css={menuItem(p === zoom)}
                onClick={() => {
                  applyZoom(p);
                  close();
                }}
              >
                {p}%
              </button>
            ))}
          </div>
        )}
      </Menu>
      <button
        type='button'
        css={iconBtn()}
        onClick={() => applyZoom(zoom + 10)}
        title='Zoom in'
      >
        <PlusIcon width={16} height={16} />
      </button>
    </>
  );
}
