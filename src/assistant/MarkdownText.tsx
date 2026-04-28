import { memo } from 'react';
import { css } from '@emotion/react';
import { Streamdown, type Components } from 'streamdown';

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

const components: Components = {
  a: ({ href, children }) => (
    <a
      href={href}
      target='_blank'
      rel='noopener noreferrer'
      css={assistantLink}
    >
      {children}
    </a>
  )
};

const MarkdownText = memo(({ text }: MarkdownTextProps) => {
  return <Streamdown components={components}>{text}</Streamdown>;
});

MarkdownText.displayName = 'MarkdownText';

export default MarkdownText;
