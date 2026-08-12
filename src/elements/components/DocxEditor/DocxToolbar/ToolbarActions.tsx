import React, { forwardRef } from 'react';
import Menu from './Menu';
import {
  ChevronDownIcon,
  DownloadIcon,
  SaveIcon,
  SignatureIcon,
  SpinnerIcon
} from '../icons';
import {
  downloadBtn,
  EDGE_PAD,
  FEATHERY_RED,
  FEATHERY_RED_HOVER,
  menuItem,
  terminalBtn,
  ZINC
} from './styles';

export interface ToolbarActionsProps {
  onSave?: () => void;
  onDownload?: () => void;
  /** When provided, Download becomes a DOCX / PDF menu. */
  onDownloadPdf?: () => void;
  /** True while a download/export is running (disables the control). */
  downloadBusy?: boolean;
  terminalAction?: 'download' | 'sign' | 'draft';
  onTerminalAction?: () => void;
  /** PDF variant of the 'download' terminal action. When provided, the red
   *  terminal Download button becomes a DOCX / PDF menu. */
  onTerminalActionPdf?: () => void;
  /** Draft variant of the 'sign' terminal action (DocuSign only). When
   *  provided, the terminal Sign button becomes a Sign / Save as Draft menu. */
  onTerminalActionDraft?: () => void;
  terminalActionDisabled?: boolean;
  terminalActionLoading?: boolean;
  saving?: boolean;
  /** Unsaved edits since the last successful save — surfaces an indicator. */
  dirty?: boolean;
  /** Narrow-toolbar mode: verbose content (the "Unsaved changes" label)
   *  collapses to keep room for the tool row. Set by useToolbarOverflow. */
  compact?: boolean;
}

// Save / Download / Sign — pinned to the toolbar's right edge. The forwarded
// ref is measured by useToolbarOverflow so the centered tool cluster gets
// symmetric clearance on both sides.
const ToolbarActions = forwardRef<HTMLDivElement, ToolbarActionsProps>(
  function ToolbarActions(
    {
      onSave,
      onDownload,
      onDownloadPdf,
      downloadBusy,
      terminalAction,
      onTerminalAction,
      onTerminalActionPdf,
      onTerminalActionDraft,
      terminalActionDisabled,
      terminalActionLoading,
      saving,
      dirty,
      compact
    },
    ref
  ) {
    const terminalDisabled =
      !!terminalActionDisabled || !!terminalActionLoading;

    return (
      <div
        ref={ref}
        css={{
          position: 'absolute',
          right: EDGE_PAD,
          top: 0,
          bottom: 0,
          display: 'flex',
          alignItems: 'center',
          paddingLeft: 8,
          justifyContent: 'flex-end',
          gap: 8,
          background: '#fff',
          zIndex: 1
        }}
      >
        {/* Always rendered, hidden while clean: this region's width feeds the
            tool row's clearance (useToolbarOverflow), so the indicator popping
            in and out must not change it — otherwise every first edit shoves
            the centered tool row to the left edge, and it only recovers on an
            explicit save. */}
        <span
          css={{
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            fontSize: 13,
            color: ZINC[500],
            whiteSpace: 'nowrap',
            visibility: dirty ? 'visible' : 'hidden'
          }}
          aria-hidden={!dirty}
          title={dirty ? 'You have unsaved changes' : undefined}
        >
          <span
            css={{
              width: 8,
              height: 8,
              borderRadius: '50%',
              background: FEATHERY_RED,
              flex: '0 0 auto'
            }}
          />
          {/* On narrow toolbars the dot alone carries the state (with the
              tooltip); the label would crowd out the tool row. */}
          {!compact && 'Unsaved changes'}
        </span>
        {onDownload && onDownloadPdf ? (
          <Menu
            align='end'
            trigger={({ toggle }) => (
              <button
                type='button'
                css={{ ...downloadBtn, opacity: downloadBusy ? 0.6 : 1 }}
                onClick={toggle}
                disabled={downloadBusy}
                title={downloadBusy ? 'Preparing download…' : 'Download'}
              >
                {downloadBusy ? (
                  <SpinnerIcon width={16} height={16} />
                ) : (
                  <DownloadIcon width={16} height={16} />
                )}
                Download
                <ChevronDownIcon width={14} height={14} />
              </button>
            )}
          >
            {(close) => (
              <div css={{ width: 200 }}>
                <button
                  type='button'
                  css={menuItem()}
                  onClick={() => {
                    onDownload();
                    close();
                  }}
                >
                  Download as DOCX
                </button>
                <button
                  type='button'
                  css={menuItem()}
                  onClick={() => {
                    onDownloadPdf();
                    close();
                  }}
                >
                  Download as PDF
                </button>
              </div>
            )}
          </Menu>
        ) : onDownload ? (
          <button type='button' css={downloadBtn} onClick={onDownload}>
            <DownloadIcon width={16} height={16} />
            Download
          </button>
        ) : null}
        {terminalAction &&
          onTerminalAction &&
          (terminalAction === 'download' && onTerminalActionPdf ? (
            <Menu
              align='end'
              trigger={({ toggle }) => (
                <button
                  type='button'
                  css={terminalBtn(terminalDisabled)}
                  disabled={terminalDisabled}
                  onClick={toggle}
                  title='Saves changes before downloading'
                >
                  {terminalActionLoading ? (
                    <SpinnerIcon width={16} height={16} />
                  ) : (
                    <DownloadIcon width={16} height={16} />
                  )}
                  Download
                  <ChevronDownIcon width={14} height={14} />
                </button>
              )}
            >
              {(close) => (
                <div css={{ width: 200 }}>
                  <button
                    type='button'
                    css={menuItem()}
                    onClick={() => {
                      onTerminalAction();
                      close();
                    }}
                  >
                    Download as DOCX
                  </button>
                  <button
                    type='button'
                    css={menuItem()}
                    onClick={() => {
                      onTerminalActionPdf();
                      close();
                    }}
                  >
                    Download as PDF
                  </button>
                </div>
              )}
            </Menu>
          ) : terminalAction === 'sign' && onTerminalActionDraft ? (
            // Both signing outcomes configured: draft-then-send is a real
            // sequence, so Sign must not hide Save as Draft.
            <Menu
              align='end'
              trigger={({ toggle }) => (
                <button
                  type='button'
                  css={terminalBtn(terminalDisabled)}
                  disabled={terminalDisabled}
                  onClick={toggle}
                  title='Saves changes before continuing'
                >
                  {terminalActionLoading ? (
                    <SpinnerIcon width={16} height={16} />
                  ) : (
                    <SignatureIcon width={16} height={16} />
                  )}
                  Sign
                  <ChevronDownIcon width={14} height={14} />
                </button>
              )}
            >
              {(close) => (
                <div css={{ width: 200 }}>
                  <button
                    type='button'
                    css={menuItem()}
                    onClick={() => {
                      onTerminalAction();
                      close();
                    }}
                  >
                    Send for signature
                  </button>
                  <button
                    type='button'
                    css={menuItem()}
                    onClick={() => {
                      onTerminalActionDraft();
                      close();
                    }}
                  >
                    Save as Draft
                  </button>
                </div>
              )}
            </Menu>
          ) : (
            <button
              type='button'
              css={terminalBtn(terminalDisabled)}
              disabled={terminalDisabled}
              onClick={onTerminalAction}
              title='Saves changes before continuing'
            >
              {terminalActionLoading ? (
                <SpinnerIcon width={16} height={16} />
              ) : terminalAction === 'download' ? (
                <DownloadIcon width={16} height={16} />
              ) : (
                <SignatureIcon width={16} height={16} />
              )}
              {terminalAction === 'download'
                ? 'Download'
                : terminalAction === 'draft'
                ? 'Create Draft'
                : 'Sign'}
            </button>
          ))}
        {onSave && (
          <button
            type='button'
            css={{
              display: 'flex',
              height: 32,
              alignItems: 'center',
              gap: 6,
              borderRadius: 6,
              border: 'none',
              background: FEATHERY_RED,
              padding: '0 12px',
              fontSize: 14,
              fontWeight: 500,
              color: '#fff',
              cursor: saving ? 'default' : 'pointer',
              '&:hover': {
                background: saving ? FEATHERY_RED : FEATHERY_RED_HOVER
              }
            }}
            disabled={saving}
            onClick={onSave}
          >
            {/* Icon slot is a fixed 16px in both states, and the label stays
                "Save", so swapping in the spinner never resizes the button
                (no flicker on quick saves). */}
            {saving ? (
              <SpinnerIcon width={16} height={16} />
            ) : (
              <SaveIcon width={16} height={16} />
            )}
            Save
          </button>
        )}
      </div>
    );
  }
);

export default ToolbarActions;
