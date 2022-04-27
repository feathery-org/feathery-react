import React, { useMemo } from 'react';

const YOUTUBE_URL_REGEX = /^.*(youtu.be\/|v\/|u\/\w\/|embed\/|watch\?v=|&v=)([^#&?]*).*/;

function getEmbedUrl(url) {
  const match = url.match(YOUTUBE_URL_REGEX);
  if (!match || match[2].length !== 11) return '';
  const youtubeId = match[2];
  return `https://www.youtube.com/embed/${youtubeId}`;
}

function applyVideoStyles(element, applyStyles) {
  applyStyles.addTargets('video');
  applyStyles.applyWidth('video');
  applyStyles.applyHeight('video');
  return applyStyles;
}

function VideoElement({ element, applyStyles, elementProps = {}, children }) {
  const styles = useMemo(() => applyVideoStyles(element, applyStyles), [
    applyStyles
  ]);
  return (
    <div css={{ ...styles.getTarget('video'), position: 'relative' }}>
      <iframe
        width='100%'
        height='100%'
        frameBorder='0'
        src={getEmbedUrl(element.properties.source_url)}
        {...elementProps}
      />
      {children}
    </div>
  );
}

export default VideoElement;
