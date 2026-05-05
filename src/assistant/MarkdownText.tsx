import { memo, type ReactNode } from 'react';
import { css } from '@emotion/react';
import { Streamdown, type Components } from 'streamdown';

type LinkProps = { href?: string; children?: ReactNode };

interface MarkdownTextProps {
  text: string;
}

const assistantLink = css({
  color: '#2563eb',
  fontWeight: 400,
  textDecoration: 'underline',
  textUnderlineOffset: '0.12em',
  textDecorationSkipInk: 'auto',
  overflowWrap: 'break-word',
  '&:visited': {
    color: '#6d28d9'
  },
  '&:hover': {
    color: '#1d4ed8'
  }
});

// Streamdown's defaults are Tailwind utility classes, won't work without Tailwind (like on forms)
// Restyle via `data-streamdown` so markdown renders everywhere
const markdownReset = css(`
  & p,
  & [data-streamdown="ordered-list"],
  & [data-streamdown="unordered-list"],
  & [data-streamdown="blockquote"],
  & [data-streamdown="code-block"],
  & [data-streamdown^="heading-"],
  & [data-streamdown="horizontal-rule"] {
    margin-top: 0 !important;
    margin-bottom: 0.6em !important;
  }
  & > *:last-child,
  & p:last-child,
  & [data-streamdown="ordered-list"]:last-child,
  & [data-streamdown="unordered-list"]:last-child,
  & [data-streamdown="blockquote"]:last-child,
  & [data-streamdown="code-block"]:last-child,
  & [data-streamdown^="heading-"]:last-child {
    margin-bottom: 0 !important;
  }

  & [data-streamdown="strong"],
  & strong,
  & b {
    font-weight: 600 !important;
  }
  & em,
  & i {
    font-style: italic !important;
  }

  & [data-streamdown="heading-1"] {
    font-size: 1.25em !important;
    font-weight: 600 !important;
  }
  & [data-streamdown="heading-2"] {
    font-size: 1.15em !important;
    font-weight: 600 !important;
  }
  & [data-streamdown="heading-3"] {
    font-size: 1.05em !important;
    font-weight: 600 !important;
  }
  & [data-streamdown="heading-4"],
  & [data-streamdown="heading-5"],
  & [data-streamdown="heading-6"] {
    font-size: 1em !important;
    font-weight: 600 !important;
  }

  & [data-streamdown="ordered-list"],
  & [data-streamdown="unordered-list"] {
    padding-left: 1.25em !important;
  }
  & [data-streamdown="ordered-list"] {
    list-style: decimal !important;
  }
  & [data-streamdown="unordered-list"] {
    list-style: disc !important;
  }
  & [data-streamdown="list-item"] {
    margin-bottom: 0.2em !important;
  }
  & [data-streamdown="list-item"]:last-child {
    margin-bottom: 0 !important;
  }

  & [data-streamdown="inline-code"] {
    font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace !important;
    font-size: 0.9em !important;
    padding: 0.1em 0.3em !important;
    border-radius: 4px !important;
    background-color: rgba(0, 0, 0, 0.06) !important;
  }
  & [data-streamdown="code-block"] {
    font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace !important;
    font-size: 0.9em !important;
    padding: 0.5em 0.75em !important;
    border-radius: 6px !important;
    background-color: rgba(0, 0, 0, 0.06) !important;
    overflow-x: auto !important;
  }

  & [data-streamdown="blockquote"] {
    padding-left: 0.75em !important;
    border-left: 3px solid rgba(0, 0, 0, 0.15) !important;
    color: rgba(0, 0, 0, 0.75) !important;
  }

  & [data-streamdown="horizontal-rule"] {
    border: 0 !important;
    border-top: 1px solid rgba(0, 0, 0, 0.12) !important;
    margin: 0.6em 0 !important;
  }
`);

const components = {
  a: ({ href, children }: LinkProps) => (
    <a
      href={href}
      target='_blank'
      rel='noopener noreferrer'
      css={assistantLink}
    >
      {children}
    </a>
  )
} as unknown as Components;

const MarkdownText = memo(({ text }: MarkdownTextProps) => {
  return (
    <div css={markdownReset}>
      <Streamdown components={components}>{text}</Streamdown>
    </div>
  );
});

MarkdownText.displayName = 'MarkdownText';

export default MarkdownText;
