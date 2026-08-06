import React, { ReactNode, useRef } from 'react';
import { featheryWindow } from '../../../../utils/browser';
import { ChevronDownIcon } from '../icons';
import Menu from './Menu';
import ToolbarActions, { ToolbarActionsProps } from './ToolbarActions';
import {
  AlignGroup,
  FontGroup,
  FormatGroup,
  GROUP_KEYS,
  GroupKey,
  HistoryGroup,
  InsertGroup,
  ListsGroup,
  StyleGroup,
  TableGroup,
  ZoomGroup
} from './groups';
import { useEditorFormatState } from './useEditorFormatState';
import { MORE_KEY, useToolbarOverflow } from './useToolbarOverflow';
import { groupSpan, ROW_GAP, TOOLBAR_HEIGHT, triggerBtn, ZINC } from './styles';

function Divider() {
  return (
    <span
      css={{ margin: '0 4px', height: 20, width: 1, background: ZINC[200] }}
    />
  );
}

const MoreIcon = (p: React.SVGProps<SVGSVGElement>) => (
  <svg
    width='24'
    height='24'
    viewBox='0 0 24 24'
    fill='currentColor'
    xmlns='http://www.w3.org/2000/svg'
    {...p}
  >
    <circle cx='5' cy='12' r='2' />
    <circle cx='12' cy='12' r='2' />
    <circle cx='19' cy='12' r='2' />
  </svg>
);

export interface DocxToolbarProps extends ToolbarActionsProps {
  /** Live Syncfusion DocumentEditor instance. */
  editor: any;
  readOnly?: boolean;
}

// Flat toolbar driving the Syncfusion documentEditor API directly (the built-in
// toolbar is disabled on the container). Active states track the editor's
// selectionChange / zoomFactorChange events (useEditorFormatState). When the
// toolbar is too narrow, tool groups collapse tail-first into a "More"
// dropdown and return inline as space allows — fit is measured against a
// hidden copy of the full row (useToolbarOverflow).
export default function DocxToolbar({
  editor,
  readOnly,
  ...actionProps
}: DocxToolbarProps) {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const format = useEditorFormatState(editor);
  const {
    rootRef,
    measureRowRef,
    setMeasureEl,
    visibleCount,
    centered,
    layerLeft,
    layerRight,
    actionRef,
    compact
  } = useToolbarOverflow();

  const insertImageFile = (file: File) => {
    const reader = new FileReader();
    reader.onload = () => {
      const src = reader.result as string;
      const img = new (featheryWindow().Image)();
      img.onload = () => editor.editor.insertImage(src, img.width, img.height);
      img.src = src;
    };
    reader.readAsDataURL(file);
  };

  const groupNodes: Record<GroupKey, ReactNode> = {
    history: <HistoryGroup editor={editor} readOnly={readOnly} />,
    zoom: (
      <ZoomGroup
        editor={editor}
        zoom={format.zoom}
        applyZoom={format.applyZoom}
        refreshZoom={format.refreshZoom}
      />
    ),
    style: (
      <StyleGroup
        editor={editor}
        readOnly={readOnly}
        styleName={format.styleName}
      />
    ),
    font: (
      <FontGroup
        editor={editor}
        readOnly={readOnly}
        fontFamily={format.fontFamily}
        fontSize={format.fontSize}
        setFontSize={format.setFontSize}
      />
    ),
    format: (
      <FormatGroup
        editor={editor}
        readOnly={readOnly}
        bold={format.bold}
        italic={format.italic}
        strike={format.strike}
        fontColor={format.fontColor}
        setFontColor={format.setFontColor}
      />
    ),
    align: (
      <AlignGroup
        editor={editor}
        readOnly={readOnly}
        alignment={format.alignment}
      />
    ),
    insert: (
      <InsertGroup
        editor={editor}
        readOnly={readOnly}
        onPickImage={() => fileInputRef.current?.click()}
      />
    ),
    // Conditional group: null while the cursor is outside a table, and null
    // groups drop out of both rendered rows (see renderGroupRow).
    table: format.isInTable ? (
      <TableGroup
        editor={editor}
        readOnly={readOnly}
        trackChangesOn={format.trackChangesOn}
        cellShading={format.cellShading}
        setCellShading={format.setCellShading}
      />
    ) : null,
    lists: <ListsGroup editor={editor} readOnly={readOnly} />
  };

  // Shared by the visible row and the hidden measurement row so their
  // structures (spans, dividers, gaps) can never drift apart. Collapse is
  // tail-first, so the visible subset is always a prefix of GROUP_KEYS and
  // the index-based leading dividers line up in both rows. Conditional groups
  // (table) render null out of context — drop them from BOTH rows so no stray
  // divider is left behind and the overflow hook measures their detached
  // measurement span at zero width.
  const renderGroupRow = (keys: readonly GroupKey[], measure: boolean) =>
    keys
      .filter((k) => groupNodes[k] !== null)
      .map((k, i) => (
        <span
          key={k}
          css={groupSpan}
          ref={measure ? setMeasureEl(k) : undefined}
        >
          {i > 0 && <Divider />}
          {groupNodes[k]}
        </span>
      ));

  // Overflowed groups that actually render something — a null conditional
  // group in the tail must not produce an empty "More" panel row (or an empty
  // panel outright).
  const hiddenKeys = GROUP_KEYS.slice(visibleCount).filter(
    (k) => groupNodes[k] !== null
  );

  return (
    <div
      ref={rootRef}
      css={{
        position: 'relative',
        height: TOOLBAR_HEIGHT,
        flex: '0 0 auto',
        borderBottom: `1px solid ${ZINC[200]}`,
        background: '#fff'
      }}
    >
      {/* Tool row layer. While everything fits, the pinned action region's
          clearance is mirrored on the left so the tools center against the
          page below. When space runs short the left inset collapses to the
          edge padding and the row anchors left — showing more tools always
          beats keeping them centered, and the More trigger at the row's head
          can never be squeezed out of view. */}
      <div
        css={{
          position: 'absolute',
          left: layerLeft,
          right: layerRight,
          top: 0,
          bottom: 0,
          display: 'flex',
          alignItems: 'center',
          justifyContent: centered ? 'center' : 'flex-start',
          minWidth: 0
        }}
      >
        {/* Hidden measurement row: always renders every group (plus the More
            trigger) at natural width so the overflow hook can read true sizes
            even while the visible row shows fewer. width: max-content is
            load-bearing — without it this absolutely-positioned row would
            shrink-to-fit and squeeze the spans, corrupting the measurements.
            The clip wrapper keeps the overflowing copy out of the document's
            scrollable area. */}
        <div
          aria-hidden
          css={{
            position: 'absolute',
            inset: 0,
            overflow: 'hidden',
            visibility: 'hidden',
            pointerEvents: 'none'
          }}
        >
          <div
            ref={measureRowRef}
            css={{
              display: 'flex',
              alignItems: 'center',
              gap: ROW_GAP,
              width: 'max-content'
            }}
          >
            {renderGroupRow(GROUP_KEYS, true)}
            <span css={groupSpan} ref={setMeasureEl(MORE_KEY)}>
              <Divider />
              <button type='button' css={triggerBtn} tabIndex={-1}>
                <MoreIcon width={16} height={16} />
                <ChevronDownIcon width={14} height={14} />
              </button>
            </span>
          </div>
        </div>

        {/* Visible row: the first visibleCount groups; the rest render inside
            "More". overflow: clip is a safety net only (the overflow hook
            keeps the content within bounds) — clip rather than hidden because
            a hidden box is still programmatically scrollable, so focusing a
            sub-pixel clipped button would shift scrollLeft and misalign the
            row. */}
        <div
          css={{
            display: 'flex',
            alignItems: 'center',
            gap: ROW_GAP,
            maxWidth: '100%',
            overflow: 'clip'
          }}
        >
          {renderGroupRow(GROUP_KEYS.slice(0, visibleCount), false)}
          {hiddenKeys.length > 0 && (
            <span css={groupSpan}>
              {visibleCount > 0 && <Divider />}
              {/* Remount when membership changes mid-resize: the panel's
                  fixed position is captured at open time and would go stale
                  (and list the wrong groups) otherwise. */}
              <Menu
                key={visibleCount}
                align='end'
                trigger={({ toggle }) => (
                  <button
                    type='button'
                    css={triggerBtn}
                    onClick={toggle}
                    title='More tools'
                  >
                    <MoreIcon width={16} height={16} />
                    <ChevronDownIcon width={14} height={14} />
                  </button>
                )}
              >
                {() => (
                  <div
                    css={{
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 8,
                      minWidth: 220,
                      maxHeight: 'min(60vh, 480px)',
                      overflowY: 'auto'
                    }}
                  >
                    {hiddenKeys.map((k) => (
                      <div
                        key={k}
                        css={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: 2,
                          flexWrap: 'wrap'
                        }}
                      >
                        {groupNodes[k]}
                      </div>
                    ))}
                  </div>
                )}
              </Menu>
            </span>
          )}
        </div>
      </div>

      {/* Hoisted out of InsertGroup: that group renders in both the hidden
          measurement row and the visible row/More panel, and two mounted
          copies would fight over this single ref. */}
      <input
        ref={fileInputRef}
        type='file'
        accept='image/*'
        css={{ display: 'none' }}
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) insertImageFile(file);
          e.target.value = '';
        }}
      />

      <ToolbarActions ref={actionRef} {...actionProps} compact={compact} />
    </div>
  );
}
