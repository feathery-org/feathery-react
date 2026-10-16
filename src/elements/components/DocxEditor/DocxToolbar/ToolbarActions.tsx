import React, { forwardRef } from 'react';
import Menu from './Menu';
import DocumentSaveStatus from '../../DocumentEditor/DocumentSaveStatus';
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
  terminalBtn
} from './styles';

export interface ToolbarActionsProps {
  onSave?: () => void;
  onSaveAll?: () => void;
  onDownloadAll?: () => void;
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
      onSaveAll,
      onDownloadAll,
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
          zIndex: 1,
          '@container document-editor (max-width: 560px)': {
            '& [data-action-label]': { display: 'none' }
          }
        }}
      >
        {onDownload && (onDownloadPdf || onDownloadAll) ? (
          <Menu
            align='end'
            trigger={({ toggle }) => (
              <button
                type='button'
                css={{ ...downloadBtn, opacity: downloadBusy ? 0.6 : 1 }}
                onClick={toggle}
                disabled={downloadBusy}
                aria-label='Download'
                title={downloadBusy ? 'Preparing download…' : 'Download'}
              >
                {downloadBusy ? (
                  <SpinnerIcon width={16} height={16} />
                ) : (
                  <DownloadIcon width={16} height={16} />
                )}
                <span data-action-label>Download</span>
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
                  {onDownloadAll ? 'This document as DOCX' : 'Download as DOCX'}
                </button>
                {onDownloadPdf && (
                  <button
                    type='button'
                    css={menuItem()}
                    onClick={() => {
                      onDownloadPdf?.();
                      close();
                    }}
                  >
                    {onDownloadAll ? 'This document as PDF' : 'Download as PDF'}
                  </button>
                )}
                {onDownloadAll && (
                  <button
                    type='button'
                    css={menuItem()}
                    onClick={() => {
                      onDownloadAll();
                      close();
                    }}
                  >
                    All documents (ZIP)
                  </button>
                )}
              </div>
            )}
          </Menu>
        ) : onDownload ? (
          <button
            type='button'
            css={{ ...downloadBtn, opacity: downloadBusy ? 0.6 : 1 }}
            onClick={onDownload}
            disabled={downloadBusy}
            aria-label='Download'
            title={downloadBusy ? 'Preparing download…' : 'Download'}
          >
            {downloadBusy ? (
              <SpinnerIcon width={16} height={16} />
            ) : (
              <DownloadIcon width={16} height={16} />
            )}
            <span data-action-label>Download</span>
          </button>
        ) : null}
        {terminalAction &&
          onTerminalAction &&
          (terminalAction === 'download' &&
          (onTerminalActionPdf || onDownloadAll) ? (
            <Menu
              align='end'
              trigger={({ toggle }) => (
                <button
                  type='button'
                  css={terminalBtn(terminalDisabled)}
                  disabled={terminalDisabled}
                  onClick={toggle}
                  aria-label='Download'
                  title='Saves changes before downloading'
                >
                  {terminalActionLoading ? (
                    <SpinnerIcon width={16} height={16} />
                  ) : (
                    <DownloadIcon width={16} height={16} />
                  )}
                  <span data-action-label>Download</span>
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
                    {onDownloadAll
                      ? 'This document as DOCX'
                      : 'Download as DOCX'}
                  </button>
                  {onTerminalActionPdf && (
                    <button
                      type='button'
                      css={menuItem()}
                      onClick={() => {
                        onTerminalActionPdf?.();
                        close();
                      }}
                    >
                      {onDownloadAll
                        ? 'This document as PDF'
                        : 'Download as PDF'}
                    </button>
                  )}
                  {onDownloadAll && (
                    <button
                      type='button'
                      css={menuItem()}
                      onClick={() => {
                        onDownloadAll();
                        close();
                      }}
                    >
                      All documents (ZIP)
                    </button>
                  )}
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
                  aria-label='Sign'
                  title='Saves changes before continuing'
                >
                  {terminalActionLoading ? (
                    <SpinnerIcon width={16} height={16} />
                  ) : (
                    <SignatureIcon width={16} height={16} />
                  )}
                  <span data-action-label>Sign</span>
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
              aria-label={
                terminalAction === 'download'
                  ? 'Download'
                  : terminalAction === 'draft'
                  ? 'Create Draft'
                  : 'Sign'
              }
              title='Saves changes before continuing'
            >
              {terminalActionLoading ? (
                <SpinnerIcon width={16} height={16} />
              ) : terminalAction === 'download' ? (
                <DownloadIcon width={16} height={16} />
              ) : (
                <SignatureIcon width={16} height={16} />
              )}
              <span data-action-label>
                {terminalAction === 'download'
                  ? 'Download'
                  : terminalAction === 'draft'
                  ? 'Create Draft'
                  : 'Sign'}
              </span>
            </button>
          ))}
        <DocumentSaveStatus dirty={dirty} compact={compact} />
        {onSave && onSaveAll ? (
          <Menu
            align='end'
            trigger={({ open, toggle }) => (
              <div css={{ display: 'flex' }}>
                <button
                  type='button'
                  css={{
                    ...terminalBtn(!!saving),
                    borderRadius: '6px 0 0 6px'
                  }}
                  disabled={saving}
                  onClick={() => {
                    if (open) toggle();
                    onSave();
                  }}
                  title='Save this document (Ctrl/Cmd+S)'
                >
                  {saving ? (
                    <SpinnerIcon width={16} height={16} />
                  ) : (
                    <SaveIcon width={16} height={16} />
                  )}
                  Save
                </button>
                <button
                  type='button'
                  css={{
                    ...terminalBtn(!!saving),
                    borderRadius: '0 6px 6px 0',
                    padding: '0 6px',
                    borderLeft: '1px solid rgba(255,255,255,.35)'
                  }}
                  disabled={saving}
                  onClick={toggle}
                  aria-label='Save options'
                  aria-expanded={open}
                  aria-haspopup='true'
                >
                  <ChevronDownIcon width={14} height={14} />
                </button>
              </div>
            )}
          >
            {(close) => (
              <div css={{ width: 200 }}>
                <button
                  type='button'
                  css={menuItem()}
                  onClick={() => {
                    onSave();
                    close();
                  }}
                >
                  Save this document
                </button>
                <button
                  type='button'
                  css={menuItem()}
                  onClick={() => {
                    onSaveAll();
                    close();
                  }}
                >
                  Save All Documents
                </button>
              </div>
            )}
          </Menu>
        ) : (
          onSave && (
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
          )
        )}
      </div>
    );
  }
);

export default ToolbarActions;
