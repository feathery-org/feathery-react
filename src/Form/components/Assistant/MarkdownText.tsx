import { memo, ReactNode } from 'react';

// Regex patterns defined outside component to avoid recreation
const BOLD_PATTERN = /\*\*(.+?)\*\*/g;
const H3_PATTERN = /^###\s+(.+)$/;
const H2_PATTERN = /^##\s+(.+)$/;
const H1_PATTERN = /^#\s+(.+)$/;
const LIST_PATTERN = /^[-*]\s+(.+)$/;

const processBold = (text: string): ReactNode[] => {
  const parts = text.split(BOLD_PATTERN);
  return parts.map((part, i) =>
    i % 2 === 1 ? <strong key={i}>{part}</strong> : part
  );
};

interface MarkdownTextProps {
  text: string;
}

// Simple markdown renderer for headers, bold, and lists
const MarkdownText = memo(({ text }: MarkdownTextProps) => {
  const lines = text.split('\n');

  return (
    <span>
      {lines.map((line, i) => {
        const h3Match = line.match(H3_PATTERN);
        if (h3Match) {
          return (
            <div
              key={i}
              css={{ fontWeight: 600, fontSize: '14px', marginTop: '6px' }}
            >
              {processBold(h3Match[1])}
            </div>
          );
        }
        const h2Match = line.match(H2_PATTERN);
        if (h2Match) {
          return (
            <div
              key={i}
              css={{ fontWeight: 600, fontSize: '15px', marginTop: '8px' }}
            >
              {processBold(h2Match[1])}
            </div>
          );
        }
        const h1Match = line.match(H1_PATTERN);
        if (h1Match) {
          return (
            <div
              key={i}
              css={{ fontWeight: 700, fontSize: '16px', marginTop: '10px' }}
            >
              {processBold(h1Match[1])}
            </div>
          );
        }
        const listMatch = line.match(LIST_PATTERN);
        if (listMatch) {
          return (
            <div key={i} css={{ marginLeft: '12px' }}>
              • {processBold(listMatch[1])}
            </div>
          );
        }
        return (
          <span key={i}>
            {processBold(line)}
            {i < lines.length - 1 && <br />}
          </span>
        );
      })}
    </span>
  );
});

MarkdownText.displayName = 'MarkdownText';

export default MarkdownText;
