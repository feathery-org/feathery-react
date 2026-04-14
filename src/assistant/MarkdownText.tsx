import { memo } from 'react';
import { Streamdown } from 'streamdown';

interface MarkdownTextProps {
  text: string;
}

const MarkdownText = memo(({ text }: MarkdownTextProps) => {
  return <Streamdown>{text}</Streamdown>;
});

MarkdownText.displayName = 'MarkdownText';

export default MarkdownText;
