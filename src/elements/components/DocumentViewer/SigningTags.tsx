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
// On the page the fill is see-through, so a tag never hides what it covers.
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

const TAG_FILL_ALPHA = '99';
const SIGNER_ATTR = 'data-signing-signer';

/** Moves to a recipient's next tag under `container`, in reading order and
 * wrapping at the end, and returns its position; -1 when they have none.
 * `after` is the position returned last time. */
export function focusNextSignerTag(
  container: HTMLElement,
  signer: number,
  after: number,
  smooth: boolean
): number {
  const tags = Array.from(
    container.querySelectorAll<HTMLElement>(`[${SIGNER_ATTR}="${signer}"]`)
  )
    .map((el) => ({ el, rect: el.getBoundingClientRect() }))
    .sort((a, b) => a.rect.top - b.rect.top || a.rect.left - b.rect.left);
  if (!tags.length) return -1;
  const next = (after + 1) % tags.length;
  const { el } = tags[next];
  el.scrollIntoView({ behavior: smooth ? 'smooth' : 'auto', block: 'center' });
  el.focus({ preventScroll: true });
  return next;
}

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
            tabIndex={-1}
            data-signing-tag={tag.type}
            data-signing-signer={tag.signer}
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
              backgroundColor: `${fill}${TAG_FILL_ALPHA}`,
              border: `1px solid ${border}`,
              borderRadius: 3,
              outline: 'none',
              '&:focus': { boxShadow: `0 0 0 3px ${border}` },
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
  // Pressing a recipient steps to their next tag.
  onJump: (signer: number) => void;
}

/** Which color is which recipient, and a way through each one's tags. Lists
 * only recipients with a tag somewhere in the packet, keeping each one's own
 * color. */
export function SignerLegend({ signers, tags, onJump }: SignerLegendProps) {
  const counts: Record<number, number> = {};
  tags.forEach((tag) => {
    counts[tag.signer] = (counts[tag.signer] ?? 0) + 1;
  });
  const tagged = Object.keys(counts)
    .map(Number)
    .sort((a, b) => a - b);
  if (!tagged.length) return null;
  return (
    <ul
      aria-label='Signers'
      css={{
        flex: 'none',
        display: 'flex',
        flexWrap: 'wrap',
        alignItems: 'center',
        gap: '4px 8px',
        margin: 0,
        padding: '6px 24px',
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
          <li key={signer}>
            <button
              type='button'
              title={`Go to the next field for ${signerName(signers, signer)}`}
              onClick={() => onJump(signer)}
              css={{
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                padding: '4px 8px',
                border: '1px solid transparent',
                borderRadius: radius.sm,
                background: 'none',
                color: 'inherit',
                font: 'inherit',
                cursor: 'pointer',
                '&:hover': { backgroundColor: color.surfaceHover },
                '&:focus-visible': { borderColor: border, outline: 'none' }
              }}
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
              <span css={{ color: color.textMuted, fontSize: fontSize.sm }}>
                {counts[signer]}
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}
