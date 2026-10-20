import React, { useRef, useState } from 'react';
import { ViewerDocument, documentUrl } from '../index';
import { color, fontSize, radius } from '../tokens';
import { iconButtonCss, secondaryButtonCss } from '../buttonStyles';
import {
  ChevronDownIcon,
  ChevronUpIcon,
  CloseIcon,
  GripIcon,
  PaperclipIcon
} from '../icons';

/** Packet editing (`editor_allow_attachments`): add, remove and reorder. */
export interface PacketEditor {
  disabled: boolean;
  onAddFiles: (files: File[]) => void;
  onMove: (from: number, to: number) => void;
  onRemove: (index: number) => void;
}

interface DocumentsPanelProps {
  documents: ViewerDocument[];
  onNavigate: (pdfUrl: string, pageIndex: number) => void;
  packetEditor?: PacketEditor;
}

const DRAG_TYPE = 'application/x-feathery-document-index';

const documentLabel = (doc: ViewerDocument) =>
  doc.name ?? doc.file_name ?? 'Document';

export default function DocumentsPanel({
  documents,
  onNavigate,
  packetEditor
}: DocumentsPanelProps) {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [dropIndex, setDropIndex] = useState<number | null>(null);
  const [announcement, setAnnouncement] = useState('');

  if (!documents.length && !packetEditor) return null;
  const editable = !!packetEditor && !packetEditor.disabled;

  const move = (from: number, to: number) => {
    if (!packetEditor || to < 0 || to >= documents.length) return;
    packetEditor.onMove(from, to);
    setAnnouncement(
      `Moved ${documentLabel(documents[from])} to position ${to + 1} of ${
        documents.length
      }`
    );
  };

  const endDrag = () => {
    setDragIndex(null);
    setDropIndex(null);
  };

  // Rows reorder each other; files dropped in from the desktop are attached.
  // A row moves only when dropped on a row (index); a drop between rows or
  // on the list itself just attaches any files it carries.
  const onDrop = (e: React.DragEvent, index?: number) => {
    e.preventDefault();
    if (editable) {
      if (dragIndex !== null) {
        if (index !== undefined) move(dragIndex, index);
      } else if (e.dataTransfer.files.length) {
        packetEditor?.onAddFiles(Array.from(e.dataTransfer.files));
      }
    }
    endDrag();
  };

  return (
    <div css={{ padding: 8, display: 'flex', flexDirection: 'column', gap: 8 }}>
      <ol
        aria-label='Documents'
        css={{
          listStyle: 'none',
          margin: 0,
          padding: 0,
          display: 'flex',
          flexDirection: 'column',
          gap: 2
        }}
        onDragOver={(e) => editable && e.preventDefault()}
        onDrop={(e) => onDrop(e)}
      >
        {documents.map((doc, index) => (
          <li
            key={doc.envelope_id ?? documentUrl(doc)}
            draggable={editable}
            onDragStart={(e) => {
              setDragIndex(index);
              e.dataTransfer.effectAllowed = 'move';
              e.dataTransfer.setData(DRAG_TYPE, String(index));
            }}
            onDragOver={(e) => {
              if (!editable) return;
              e.preventDefault();
              e.stopPropagation();
              setDropIndex(index);
            }}
            onDrop={(e) => {
              e.stopPropagation();
              onDrop(e, index);
            }}
            onDragEnd={endDrag}
            css={{
              display: 'flex',
              alignItems: 'center',
              gap: 2,
              borderRadius: radius.sm,
              opacity: dragIndex === index ? 0.4 : 1,
              boxShadow:
                dropIndex === index && dragIndex !== index
                  ? `inset 0 ${
                      dragIndex !== null && dragIndex < index ? -2 : 2
                    }px 0 ${color.accent}`
                  : 'none',
              '&:hover': { backgroundColor: color.surfaceHover }
            }}
          >
            {packetEditor && (
              <span
                aria-hidden
                css={{
                  display: 'flex',
                  color: color.textMuted,
                  cursor: editable ? 'grab' : 'default',
                  paddingLeft: 4
                }}
              >
                <GripIcon size={14} />
              </span>
            )}
            <button
              type='button'
              onClick={() => onNavigate(documentUrl(doc), 0)}
              css={rowButtonCss}
            >
              <span css={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {documentLabel(doc)}
              </span>
              {doc.type === 'attachment' && (
                <span css={badgeCss}>
                  <PaperclipIcon size={11} />
                  Attachment
                </span>
              )}
            </button>
            {packetEditor && (
              <span css={{ display: 'flex', flexShrink: 0 }}>
                <button
                  type='button'
                  aria-label={`Move ${documentLabel(doc)} up`}
                  disabled={!editable || index === 0}
                  onClick={() => move(index, index - 1)}
                  css={rowIconButtonCss}
                >
                  <ChevronUpIcon size={14} />
                </button>
                <button
                  type='button'
                  aria-label={`Move ${documentLabel(doc)} down`}
                  disabled={!editable || index === documents.length - 1}
                  onClick={() => move(index, index + 1)}
                  css={rowIconButtonCss}
                >
                  <ChevronDownIcon size={14} />
                </button>
                {doc.type === 'attachment' && (
                  <button
                    type='button'
                    aria-label={`Remove ${documentLabel(doc)}`}
                    disabled={!editable}
                    onClick={() => {
                      packetEditor.onRemove(index);
                      setAnnouncement(`Removed ${documentLabel(doc)}`);
                    }}
                    css={rowIconButtonCss}
                  >
                    <CloseIcon size={14} />
                  </button>
                )}
              </span>
            )}
          </li>
        ))}
      </ol>
      {packetEditor && (
        <>
          <button
            type='button'
            disabled={packetEditor.disabled}
            onClick={() => fileInputRef.current?.click()}
            css={{ ...secondaryButtonCss, width: '100%' }}
          >
            <PaperclipIcon size={14} />
            Add attachment
          </button>
          <input
            ref={fileInputRef}
            type='file'
            multiple
            hidden
            data-testid='attachment-input'
            onChange={(e) => {
              const files = Array.from(e.target.files ?? []);
              // Reset so picking the same file again still fires onChange.
              e.target.value = '';
              packetEditor.onAddFiles(files);
            }}
          />
          <p
            css={{
              margin: 0,
              fontSize: fontSize.xs,
              color: color.textMuted,
              textAlign: 'center'
            }}
          >
            Drag to reorder, or drop files here to attach them.
          </p>
        </>
      )}
      <div aria-live='polite' css={visuallyHiddenCss}>
        {announcement}
      </div>
    </div>
  );
}

const rowButtonCss = {
  flex: 1,
  minWidth: 0,
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  border: 'none',
  background: 'transparent',
  textAlign: 'left' as const,
  cursor: 'pointer',
  fontSize: fontSize.md,
  padding: '8px 6px',
  borderRadius: radius.sm,
  color: color.text,
  whiteSpace: 'nowrap' as const,
  '&:hover': { color: color.accent },
  '&:focus-visible': { outline: `2px solid ${color.accent}`, outlineOffset: -2 }
};

const rowIconButtonCss = { ...iconButtonCss, padding: 4 };

const badgeCss = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 3,
  flexShrink: 0,
  padding: '1px 6px',
  borderRadius: radius.pill,
  backgroundColor: color.accentSoft,
  color: color.accent,
  fontSize: fontSize.xs
};

const visuallyHiddenCss = {
  position: 'absolute' as const,
  width: 1,
  height: 1,
  overflow: 'hidden',
  clip: 'rect(0 0 0 0)',
  whiteSpace: 'nowrap' as const
};
