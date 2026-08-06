import React from 'react';
import Menu from '../Menu';
import {
  BordersIcon,
  DeleteTableIcon,
  InsertColumnIcon,
  InsertRowIcon,
  MergeCellsIcon,
  ShadingIcon,
  TableShadingIcon
} from '../../icons';
import { iconBtn, menuItem } from '../styles';

// Border presets map 1:1 onto Syncfusion BorderType values; applyBorders
// defaults the rest of BorderSettings to a 1pt single black line.
const BORDER_PRESETS = [
  ['All borders', 'AllBorders'],
  ['Outside borders', 'OutsideBorders'],
  ['Inside borders', 'InsideBorders'],
  ['No borders', 'NoBorder']
] as const;

const TRACK_CHANGES_HINT = 'Not available while track changes is on';

// Table tools, shown only while the cursor is inside a table (the toolbar
// renders this slot as null otherwise — see groupNodes in ../index.tsx).
//
// Track-changes gating: structural column ops have no tracked route in this
// Syncfusion version — deleteColumn/mergeCells pop a blocking "won't be
// marked as change" dialog and insertColumn applies silently with ZERO
// revisions, surviving reject-all (probed on a real DocumentEditor; see the
// op-vocabulary comment in assistant/tools/docx/syncfusionDocumentOps.ts).
// insertRow is properly tracked. deleteRow/deleteTable are unprobed — gated
// too until verified. Shading and borders are format changes and stay open.
export default function TableGroup({
  editor,
  readOnly,
  trackChangesOn,
  cellShading,
  setCellShading,
  tableShading,
  setTableShading
}: {
  editor: any;
  readOnly?: boolean;
  trackChangesOn: boolean;
  cellShading: string;
  setCellShading: (hex: string) => void;
  tableShading: string;
  setTableShading: (hex: string) => void;
}) {
  const gated = !!readOnly || trackChangesOn;
  const gatedTitle = (label: string) =>
    trackChangesOn && !readOnly ? `${label} — ${TRACK_CHANGES_HINT}` : label;

  const item = (
    label: string,
    run: () => void,
    close: () => void,
    disabled: boolean,
    title = label
  ) => (
    <button
      type='button'
      css={{
        ...menuItem(),
        ...(disabled ? { opacity: 0.4, cursor: 'default' } : {})
      }}
      disabled={disabled}
      title={title}
      onClick={() => {
        run();
        close();
      }}
    >
      {label}
    </button>
  );

  const shadingPicker = (
    title: string,
    value: string,
    onPick: (hex: string) => void,
    Icon: typeof ShadingIcon
  ) => (
    <label
      css={{ ...iconBtn(false, readOnly), position: 'relative' }}
      title={title}
    >
      <Icon width={16} height={16} />
      <span
        css={{
          position: 'absolute',
          bottom: 4,
          height: 2,
          width: 16,
          borderRadius: 2
        }}
        style={{ backgroundColor: value }}
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
        value={value}
        disabled={readOnly}
        onChange={(e) => onPick(e.target.value)}
      />
    </label>
  );

  return (
    <>
      <Menu
        trigger={({ toggle }) => (
          <button
            type='button'
            css={iconBtn(false, readOnly)}
            disabled={readOnly}
            onClick={toggle}
            title='Table rows'
          >
            <InsertRowIcon width={16} height={16} />
          </button>
        )}
      >
        {(close) => (
          <div
            css={{ display: 'flex', flexDirection: 'column', minWidth: 180 }}
          >
            {item(
              'Insert row above',
              () => editor.editor.insertRow(true, 1),
              close,
              !!readOnly
            )}
            {item(
              'Insert row below',
              () => editor.editor.insertRow(false, 1),
              close,
              !!readOnly
            )}
            {item(
              'Delete row',
              () => editor.editor.deleteRow(),
              close,
              gated,
              gatedTitle('Delete row')
            )}
          </div>
        )}
      </Menu>
      <Menu
        trigger={({ toggle }) => (
          <button
            type='button'
            css={iconBtn(false, readOnly)}
            disabled={readOnly}
            onClick={toggle}
            title='Table columns'
          >
            <InsertColumnIcon width={16} height={16} />
          </button>
        )}
      >
        {(close) => (
          <div
            css={{ display: 'flex', flexDirection: 'column', minWidth: 180 }}
          >
            {item(
              'Insert column left',
              () => editor.editor.insertColumn(true, 1),
              close,
              gated,
              gatedTitle('Insert column left')
            )}
            {item(
              'Insert column right',
              () => editor.editor.insertColumn(false, 1),
              close,
              gated,
              gatedTitle('Insert column right')
            )}
            {item(
              'Delete column',
              () => editor.editor.deleteColumn(),
              close,
              gated,
              gatedTitle('Delete column')
            )}
          </div>
        )}
      </Menu>
      <button
        type='button'
        css={iconBtn(false, gated)}
        disabled={gated}
        onClick={() => editor.editor.mergeCells()}
        title={gatedTitle('Merge cells')}
      >
        <MergeCellsIcon width={16} height={16} />
      </button>
      <Menu
        trigger={({ toggle }) => (
          <button
            type='button'
            css={iconBtn(false, readOnly)}
            disabled={readOnly}
            onClick={toggle}
            title='Borders'
          >
            <BordersIcon width={16} height={16} />
          </button>
        )}
      >
        {(close) => (
          <div
            css={{ display: 'flex', flexDirection: 'column', minWidth: 180 }}
          >
            {BORDER_PRESETS.map(([label, type]) => (
              <button
                key={type}
                type='button'
                css={menuItem()}
                disabled={readOnly}
                onClick={() => {
                  editor.editor.applyBorders({ type });
                  close();
                }}
              >
                {label}
              </button>
            ))}
          </div>
        )}
      </Menu>
      {shadingPicker(
        'Cell shading',
        cellShading,
        (hex) => {
          setCellShading(hex);
          editor.selection.cellFormat.background = hex;
        },
        ShadingIcon
      )}
      {shadingPicker(
        'Table shading',
        tableShading,
        (hex) => {
          setTableShading(hex);
          editor.selection.tableFormat.background = hex;
        },
        TableShadingIcon
      )}
      <button
        type='button'
        css={iconBtn(false, gated)}
        disabled={gated}
        onClick={() => editor.editor.deleteTable()}
        title={gatedTitle('Delete table')}
      >
        <DeleteTableIcon width={16} height={16} />
      </button>
    </>
  );
}
