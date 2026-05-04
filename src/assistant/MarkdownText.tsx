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

// Streamdown's default styles ride on Tailwind utility classes (see
// https://streamdown.ai/docs/styling). On hosted-form pages Tailwind isn't
// loaded so those classes are inert; on the dashboard Tailwind IS loaded and
// its utilities outrank our descendant selectors. To get identical output on
// both surfaces we restyle every Streamdown element here using its
// per-element `data-streamdown` attribute and mark each rule !important so
// neither environment's defaults can leak through.
//
// !important is justified here because this SDK ships into pages we don't
// control. A single source of truth for the chat bubble is more maintainable
// than playing specificity wars with every consumer's stylesheet.
const I = ' !important';
const markdownReset = css(`
  & p,
  & [data-streamdown="ordered-list"],
  & [data-streamdown="unordered-list"],
  & [data-streamdown="blockquote"],
  & [data-streamdown="code-block"],
  & [data-streamdown^="heading-"],
  & [data-streamdown="horizontal-rule"] {
    margin-top: 0${I};
    margin-bottom: 0.6em${I};
  }
  & > *:last-child,
  & p:last-child,
  & [data-streamdown="ordered-list"]:last-child,
  & [data-streamdown="unordered-list"]:last-child,
  & [data-streamdown="blockquote"]:last-child,
  & [data-streamdown="code-block"]:last-child,
  & [data-streamdown^="heading-"]:last-child {
    margin-bottom: 0${I};
  }

  & [data-streamdown="strong"], & strong, & b { font-weight: 600${I}; }
  & em, & i { font-style: italic${I}; }

  & [data-streamdown="heading-1"] { font-size: 1.25em${I}; font-weight: 600${I}; }
  & [data-streamdown="heading-2"] { font-size: 1.15em${I}; font-weight: 600${I}; }
  & [data-streamdown="heading-3"] { font-size: 1.05em${I}; font-weight: 600${I}; }
  & [data-streamdown="heading-4"],
  & [data-streamdown="heading-5"],
  & [data-streamdown="heading-6"] { font-size: 1em${I}; font-weight: 600${I}; }

  & [data-streamdown="ordered-list"],
  & [data-streamdown="unordered-list"] { padding-left: 1.25em${I}; }
  & [data-streamdown="ordered-list"] { list-style: decimal${I}; }
  & [data-streamdown="unordered-list"] { list-style: disc${I}; }
  & [data-streamdown="list-item"] { margin-bottom: 0.2em${I}; }
  & [data-streamdown="list-item"]:last-child { margin-bottom: 0${I}; }

  & [data-streamdown="inline-code"] {
    font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace${I};
    font-size: 0.9em${I};
    padding: 0.1em 0.3em${I};
    border-radius: 4px${I};
    background-color: rgba(0, 0, 0, 0.06)${I};
  }
  & [data-streamdown="code-block"] {
    font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace${I};
    font-size: 0.9em${I};
    padding: 0.5em 0.75em${I};
    border-radius: 6px${I};
    background-color: rgba(0, 0, 0, 0.06)${I};
    overflow-x: auto${I};
  }

  & [data-streamdown="blockquote"] {
    padding-left: 0.75em${I};
    border-left: 3px solid rgba(0, 0, 0, 0.15)${I};
    color: rgba(0, 0, 0, 0.75)${I};
  }

  & [data-streamdown="horizontal-rule"] {
    border: 0${I};
    border-top: 1px solid rgba(0, 0, 0, 0.12)${I};
    margin: 0.6em 0${I};
  }
`);

// Streamdown's `Components` map type intersects two ComponentType signatures
// in a way regular function components can't satisfy directly. Cast through
// the looser shape so each override stays plainly typed.
// Only the link needs a structural override (target/rel attributes that
// can't be set via CSS). Inline styling for strong/em/etc. is unnecessary
// now that the markdownReset rules above use !important - those win
// regardless of host-page Tailwind or resets.
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
