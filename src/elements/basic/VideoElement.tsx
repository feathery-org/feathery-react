import React, { useMemo } from 'react';

const PLACEHOLDER_VIDEO =
  'https://feathery.s3.us-west-1.amazonaws.com/video-preview.png';

const YOUTUBE_URL_REGEX =
  /^.*(youtu.be\/|v\/|u\/\w\/|embed\/|watch\?v=|&v=)([^#&?]*).*/;
const VIMEO_URL_REGEX =
  /(?:http?s?:\/\/)?(?:www\.)?vimeo\.com(?:\/video)?\/?(.+)/;

function getEmbedUrl(url) {
  let match = url.match(YOUTUBE_URL_REGEX);
  if (match && match[2].length === 11) {
    return `https://www.youtube.com/embed/${match[2]}`;
  }

  match = url.match(VIMEO_URL_REGEX);
  if (match && match[1]) {
    return `https://player.vimeo.com/video/${match[1]}`;
  }

  return url;
}

function applyVideoStyles(element, applyStyles) {
  applyStyles.addTargets('video');
  applyStyles.applyWidth('video');
  applyStyles.applyHeight('video');
  return applyStyles;
}

function VideoElement({ element, applyStyles, elementProps = {}, children }) {
  const styles = useMemo(
    () => applyVideoStyles(element, applyStyles),
    [applyStyles]
  );
  return (
    <div
      css={{
        ...styles.getTarget('video'),
        position: 'relative',
        maxHeight: '100%'
      }}
    >
      {element.properties.source_url ? (
        <iframe
          width='100%'
          height='100%'
          frameBorder='0'
          src={getEmbedUrl(element.properties.source_url)}
          {...elementProps}
        />
      ) : (
        <img
          src={PLACEHOLDER_VIDEO}
          alt='Video Placeholder'
          css={{
            objectFit: 'contain',
            width: '100%',
            maxHeight: '100%'
          }}
          {...elementProps}
        />
      )}
      {children}
    </div>
  );
}

export default VideoElement;
