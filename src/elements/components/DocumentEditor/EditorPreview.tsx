import React from 'react';
import { EDITOR_PLACEHOLDER_STYLE } from './placeholderStyle';

// Designer-only illustration: never fetch a template or mount an editing engine.
export default function EditorPreview({ type }: { type: 'pptx' | 'generic' }) {
  if (type === 'generic')
    return (
      <div css={EDITOR_PLACEHOLDER_STYLE}>
        Document editor — link all Word or all PowerPoint documents to preview
        their editor.
      </div>
    );

  return (
    <div
      role='img'
      aria-label='PowerPoint editor preview'
      css={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        minHeight: 320,
        background: '#f3f4f6',
        color: '#374151',
        fontFamily: 'Arial, sans-serif',
        pointerEvents: 'none',
        userSelect: 'none',
        overflow: 'hidden'
      }}
    >
      <div
        css={{
          padding: '14px 18px',
          background: '#fff',
          borderBottom: '1px solid #e5e7eb',
          display: 'flex',
          gap: 20,
          flexWrap: 'wrap',
          fontSize: 12
        }}
      >
        <strong>PowerPoint editor</strong>
        <span>Insert</span>
        <span>Slide</span>
        <span>Save</span>
      </div>
      <div css={{ display: 'flex', flex: 1, minHeight: 0 }}>
        <div
          css={{
            width: '18%',
            maxWidth: 140,
            minWidth: 48,
            padding: 12,
            background: '#fafafa',
            borderRight: '1px solid #e5e7eb'
          }}
        >
          {[1, 2, 3].map((slide) => (
            <div key={slide} css={{ marginBottom: 14, fontSize: 10 }}>
              {slide}
              <div
                css={{
                  aspectRatio: '16 / 9',
                  marginTop: 5,
                  background: '#fff',
                  border:
                    slide === 1 ? '2px solid #d86471' : '1px solid #d1d5db',
                  borderRadius: 3
                }}
              />
            </div>
          ))}
        </div>
        <div
          css={{
            flex: 1,
            minWidth: 0,
            padding: 'clamp(12px, 4%, 40px)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center'
          }}
        >
          <div
            css={{
              width: '100%',
              maxWidth: 900,
              aspectRatio: '16 / 9',
              background: '#fff',
              boxShadow: '0 2px 8px #00000012',
              padding: '8%',
              display: 'flex',
              flexDirection: 'column',
              justifyContent: 'center'
            }}
          >
            <div css={{ fontSize: 'clamp(16px, 2vw, 30px)', fontWeight: 600 }}>
              Presentation title
            </div>
            <div css={{ marginTop: 14, fontSize: 14, color: '#6b7280' }}>
              Your subtitle here
            </div>
          </div>
        </div>
      </div>
      <div
        css={{
          padding: '9px 18px',
          borderTop: '1px solid #e5e7eb',
          background: '#fff',
          fontSize: 11
        }}
      >
        Slide 1 of 3
      </div>
    </div>
  );
}
