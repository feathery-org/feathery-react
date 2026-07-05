import React from 'react';
import { ViewerDocument } from '../index';

interface FormsListProps {
  documents: ViewerDocument[];
  onNavigate: (docIndex: number, pageIndex: number) => void;
}

export default function FormsList({ documents, onNavigate }: FormsListProps) {
  const forms = documents
    .map((doc, docIndex) => ({ doc, docIndex }))
    .filter(({ doc }) => doc.type === 'form');

  if (!forms.length) return null;

  return (
    <section aria-label='Forms' css={{ padding: '16px 20px' }}>
      <h3 css={{ margin: '0 0 12px', fontSize: 14, fontWeight: 600 }}>Forms</h3>
      <div css={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        {forms.map(({ doc, docIndex }) => (
          <button
            key={docIndex}
            type='button'
            onClick={() => onNavigate(docIndex, 0)}
            css={formButtonCss}
          >
            {doc.form_name}
            {doc.form_id ? ` (${doc.form_id})` : ''}
          </button>
        ))}
      </div>
    </section>
  );
}

const formButtonCss = {
  border: 'none',
  background: 'transparent',
  textAlign: 'left' as const,
  cursor: 'pointer',
  fontSize: 13,
  padding: '6px 0',
  color: '#111827',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap' as const,
  '&:hover': { color: '#3b82f6' }
};
