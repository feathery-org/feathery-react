import React, { useMemo } from 'react';

const PLACEHOLDER_VIDEO =
  'https://feathery.s3.us-west-1.amazonaws.com/video-preview.png';

const YOUTUBE_URL_REGEX =
  /^.*(youtu.be\/|v\/|u\/\w\/|embed\/|watch\?v=|&v=)([^#&?]*).*/;
const VIMEO_URL_REGEX =
  /(?:http?s?:\/\/)?(?:www\.)?vimeo\.com(?:\/video)?\/?(.+)/;

function getEmbedUrl(url: any) {
  let querystring = url.split('?')[1];
  if (querystring) querystring = '?' + querystring;

  let match = url.match(YOUTUBE_URL_REGEX);
  if (match && match[2].length === 11) {
    return `https://www.youtube.com/embed/${match[2]}${querystring}`;
  }

  match = url.match(VIMEO_URL_REGEX);
  if (match && match[1]) {
    return `https://player.vimeo.com/video/${match[1]}${querystring}`;
  }

  return url;
}

function applyVideoStyles(element: any, responsiveStyles: any) {
  responsiveStyles.addTargets('video');
  responsiveStyles.applyHeight('video');
  return responsiveStyles;
}

function VideoElement({
  element,
  responsiveStyles,
  elementProps = {},
  children
}: any) {
  const styles = useMemo(
    () => applyVideoStyles(element, responsiveStyles),
    [responsiveStyles]
  );

  const props = element.properties;
  let component;
  if (props.source_url) {
    const videoType = props.source_type ?? 'iframe';
    if (videoType === 'iframe') {
      component = (
        <iframe
          width='100%'
          height='100%'
          src={getEmbedUrl(props.source_url)}
          css={{ border: 'none' }}
          {...elementProps}
        />
      );
    } else {
      component = (
        <video
          width='100%'
          height='100%'
          autoPlay={props.autoplay}
          controls={props.controls}
          muted={props.muted}
          loop={props.loop}
          aria-label={props.aria_label}
        >
          <source src={props.source_url} type={props.video_extension} />
        </video>
      );
    }
  } else {
    component = (
      <img
        src={PLACEHOLDER_VIDEO}
        alt=''
        css={{
          objectFit: 'cover',
          width: '100%',
          maxHeight: '100%'
        }}
        {...elementProps}
      />
    );
  }
  return (
    <div
      css={{
        ...styles.getTarget('video'),
        position: 'relative',
        maxHeight: '100%',
        height: '100%',
        width: '100%'
      }}
    >
      {children}
      {component}
    </div>
  );
}

export default VideoElement;
