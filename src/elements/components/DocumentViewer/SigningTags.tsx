import React from 'react';
import { color, fontSize, radius } from './tokens';

export type SigningTagType = 'sign_here' | 'initial_here' | 'date_signed';

/** Where a DocuSign recipient signs, initials or is dated on a page: a box in
 * pdf points from the page's top left, as the backend's signing preview emits
 * it. A date has no width of its own — it is as wide as its label. */
export interface SigningTag {
  type: SigningTagType;
  // Position of the recipient in the payload's `signers`.
  signer: number;
  // 0-based page within the document.
  page: number;
  x: number;
  y: number;
  width: number | null;
  height: number;
}

export interface SigningRecipient {
  name: string;
}

interface SignerColor {
  fill: string;
  border: string;
}

// One per recipient, in recipient order, cycling past the last. Light fills
// with a darker edge of the same hue, the way DocuSign tints its own tags.
const SIGNER_COLORS: SignerColor[] = [
  { fill: '#bfe6f7', border: '#1a9ed9' },
  { fill: '#b9edd3', border: '#17a567' },
  { fill: '#ffe9a6', border: '#d19a00' },
  { fill: '#f9c9d8', border: '#d4477b' },
  { fill: '#dccff8', border: '#7a5ad6' },
  { fill: '#ffd6b3', border: '#dc7a1e' }
];

export const signerColor = (signer: number): SignerColor =>
  SIGNER_COLORS[signer % SIGNER_COLORS.length];

const TAG_LABEL: Record<SigningTagType, string> = {
  sign_here: 'Sign',
  initial_here: 'Initial',
  date_signed: 'Date Signed'
};

const signerName = (signers: SigningRecipient[], signer: number) =>
  signers[signer]?.name || `Signer ${signer + 1}`;

const PenIcon = ({ size }: { size: number }) => (
  <svg
    width={size}
    height={size}
    viewBox='0 0 24 24'
    fill='none'
    stroke='currentColor'
    strokeWidth={2}
    strokeLinecap='round'
    strokeLinejoin='round'
    aria-hidden='true'
  >
    <path d='M4 20h16' />
    <path d='M14.5 4.5l3 3L9 16l-4 1 1-4 8.5-8.5z' />
  </svg>
);

interface SigningTagLayerProps {
  tags: SigningTag[];
  signers: SigningRecipient[];
  // CSS pixels per pdf point for the page the layer covers.
  scale: number;
}

/** The DocuSign tags of one page, drawn over it the way DocuSign's own sender
 * view shows them. Sits above the form widgets: a field a tag covers is one
 * DocuSign fills in, so it isn't the filler's to edit here. */
export function SigningTagLayer({
  tags,
  signers,
  scale
}: SigningTagLayerProps) {
  return (
    <div css={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}>
      {tags.map((tag, i) => {
        const { fill, border } = signerColor(tag.signer);
        const height = tag.height * scale;
        const isDate = tag.type === 'date_signed';
        const label = `${TAG_LABEL[tag.type]}: ${signerName(
          signers,
          tag.signer
        )}`;
        return (
          <div
            key={i}
            role='img'
            aria-label={label}
            title={label}
            data-signing-tag={tag.type}
            css={{
              position: 'absolute',
              left: tag.x * scale,
              top: tag.y * scale,
              width: tag.width === null ? undefined : tag.width * scale,
              height,
              boxSizing: 'border-box',
              display: 'flex',
              flexDirection: isDate ? 'row' : 'column',
              alignItems: 'center',
              justifyContent: 'center',
              padding: isDate ? `0 ${height * 0.35}px` : 0,
              backgroundColor: fill,
              border: `1px solid ${border}`,
              borderRadius: 3,
              color: color.text,
              fontFamily: 'Arial, Helvetica, sans-serif',
              fontSize: isDate ? height * 0.68 : height * 0.22,
              lineHeight: 1,
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              pointerEvents: 'auto',
              cursor: 'default',
              userSelect: 'none'
            }}
          >
            {TAG_LABEL[tag.type]}
            {!isDate && <PenIcon size={height * 0.45} />}
          </div>
        );
      })}
    </div>
  );
}

interface SignerLegendProps {
  signers: SigningRecipient[];
  tags: SigningTag[];
}

/** Which color is which recipient. Lists only recipients with a tag somewhere
 * in the packet, keeping each one's own color. */
export function SignerLegend({ signers, tags }: SignerLegendProps) {
  const tagged = Array.from(new Set(tags.map((tag) => tag.signer))).sort(
    (a, b) => a - b
  );
  if (!tagged.length) return null;
  return (
    <ul
      aria-label='Signers'
      css={{
        flex: 'none',
        display: 'flex',
        flexWrap: 'wrap',
        alignItems: 'center',
        gap: '6px 16px',
        margin: 0,
        padding: '8px 24px',
        listStyle: 'none',
        backgroundColor: color.surface,
        borderBottom: `1px solid ${color.border}`,
        color: color.text,
        fontSize: fontSize.md
      }}
    >
      <li css={{ color: color.textMuted, fontSize: fontSize.sm }}>Signers</li>
      {tagged.map((signer) => {
        const { fill, border } = signerColor(signer);
        return (
          <li
            key={signer}
            css={{ display: 'flex', alignItems: 'center', gap: 6 }}
          >
            <span
              aria-hidden='true'
              css={{
                width: 12,
                height: 12,
                boxSizing: 'border-box',
                borderRadius: radius.sm / 2,
                backgroundColor: fill,
                border: `1px solid ${border}`
              }}
            />
            {signerName(signers, signer)}
          </li>
        );
      })}
    </ul>
  );
}
