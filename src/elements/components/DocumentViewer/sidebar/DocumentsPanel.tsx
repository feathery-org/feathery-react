import React from 'react';
import { ViewerDocument } from '../index';
import { color, fontSize, radius } from '../tokens';

interface DocumentsPanelProps {
  documents: ViewerDocument[];
  onNavigate: (pdfUrl: string, pageIndex: number) => void;
}

export default function DocumentsPanel({
  documents,
  onNavigate
}: DocumentsPanelProps) {
  const forms = documents.filter((doc) => doc.type === 'form');
  if (forms.length === 0) return null;
  return (
    <div css={{ padding: 8, display: 'flex', flexDirection: 'column', gap: 2 }}>
      {forms.map((doc) => (
        <button
          key={doc.pdf_url}
          type='button'
          onClick={() => onNavigate(doc.pdf_url, 0)}
          css={rowButtonCss}
        >
          {doc.form_name ?? doc.name}
        </button>
      ))}
    </div>
  );
}

const rowButtonCss = {
  border: 'none',
  background: 'transparent',
  textAlign: 'left' as const,
  cursor: 'pointer',
  fontSize: fontSize.md,
  padding: '8px 10px',
  borderRadius: radius.sm,
  color: color.text,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap' as const,
  '&:hover': { backgroundColor: color.surfaceHover, color: color.accent }
};
