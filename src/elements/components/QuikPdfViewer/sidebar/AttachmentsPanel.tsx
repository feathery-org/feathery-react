import React, { useRef } from 'react';

interface AttachmentsPanelProps {
  attachments: { name: string }[];
  onAdd: (file: File) => void;
  onRemove: (index: number) => void;
  uploading: boolean;
}

export default function AttachmentsPanel({
  attachments,
  onAdd,
  onRemove,
  uploading
}: AttachmentsPanelProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  return (
    <section aria-label='Attachments' css={{ padding: '16px 20px' }}>
      <div
        css={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center'
        }}
      >
        <h3 css={{ margin: 0, fontSize: 14, fontWeight: 600 }}>Attachments</h3>
        <button
          type='button'
          aria-label='Add attachment'
          disabled={uploading}
          onClick={() => inputRef.current?.click()}
          css={addButtonCss}
        >
          +
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
      </div>
      {attachments.map((att, i) => (
        <div
          key={i}
          css={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            padding: '8px 0'
          }}
        >
          <span
            css={{
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              fontSize: 13
            }}
          >
            {att.name}
          </span>
          <button
            type='button'
            aria-label='Remove attachment'
            onClick={() => onRemove(i)}
            css={removeButtonCss}
          >
            🗑
          </button>
        </div>
      ))}
    </section>
  );
}

const addButtonCss = {
  border: 'none',
  background: 'transparent',
  cursor: 'pointer',
  fontSize: 16,
  lineHeight: 1,
  padding: 4,
  '&:disabled': { opacity: 0.5, cursor: 'default' }
} as const;

const removeButtonCss = {
  border: 'none',
  background: 'transparent',
  cursor: 'pointer',
  padding: 4
} as const;
