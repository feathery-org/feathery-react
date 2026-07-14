import React, { useRef } from 'react';
import { ViewerDocument } from '../index';
import { color, fontSize, radius } from '../tokens';
import { iconButtonCss } from '../buttonStyles';
import { PlusIcon, TrashIcon, SpinnerIcon } from '../icons';

interface DocumentsPanelProps {
  documents: ViewerDocument[];
  onNavigate: (pdfUrl: string, pageIndex: number) => void;
  attachments: { name: string }[];
  onAdd: (file: File) => void;
  onRemove: (index: number) => void;
  uploading: boolean;
  // Backend rejects attachments combined with a docusign sign action; the
  // docusign-sign review flow passes false so the control isn't offered.
  allowAdd?: boolean;
}

export default function DocumentsPanel({
  documents,
  onNavigate,
  attachments,
  onAdd,
  onRemove,
  uploading,
  allowAdd = true
}: DocumentsPanelProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const forms = documents.filter((doc) => doc.type === 'form');
  return (
    <div>
      {forms.length > 0 && (
        <section aria-label='Forms' css={sectionCss}>
          <h3 css={{ ...headingCss, marginBottom: 8 }}>Forms</h3>
          <div css={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            {forms.map((doc) => (
              <button
                key={doc.pdf_url}
                type='button'
                onClick={() => onNavigate(doc.pdf_url, 0)}
                css={rowButtonCss}
              >
                {doc.form_name}
              </button>
            ))}
          </div>
        </section>
      )}
      <section aria-label='Attachments' css={sectionCss}>
        <div
          css={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginBottom: 4
          }}
        >
          <h3 css={headingCss}>Attachments</h3>
          {allowAdd && (
            <>
              <button
                type='button'
                aria-label='Add attachment'
                disabled={uploading}
                onClick={() => inputRef.current?.click()}
                css={iconButtonCss}
              >
                {uploading ? <SpinnerIcon size={16} /> : <PlusIcon size={16} />}
              </button>
              <input
                ref={inputRef}
                type='file'
                accept='.pdf'
                css={{ display: 'none' }}
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) onAdd(file);
                  e.target.value = '';
                }}
              />
            </>
          )}
        </div>
        {attachments.map((att, i) => (
          <div
            key={i}
            css={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              gap: 8,
              padding: '6px 0'
            }}
          >
            <span
              css={{
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
                fontSize: fontSize.md,
                color: color.text
              }}
            >
              {att.name}
            </span>
            <button
              type='button'
              aria-label='Remove attachment'
              onClick={() => onRemove(i)}
              css={iconButtonCss}
            >
              <TrashIcon size={15} />
            </button>
          </div>
        ))}
      </section>
    </div>
  );
}

const sectionCss = {
  padding: 16,
  borderBottom: `1px solid ${color.border}`
} as const;

const headingCss = {
  margin: 0,
  fontSize: fontSize.base,
  fontWeight: 600,
  color: color.text
} as const;

const rowButtonCss = {
  border: 'none',
  background: 'transparent',
  textAlign: 'left' as const,
  cursor: 'pointer',
  fontSize: fontSize.md,
  padding: '6px 8px',
  borderRadius: radius.sm,
  color: color.text,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap' as const,
  '&:hover': { backgroundColor: color.surfaceHover, color: color.accent }
};
