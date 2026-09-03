import { render } from '@testing-library/react';
import VideoElement from '../VideoElement';

const responsiveStyles = {
  addTargets: jest.fn(),
  applyHeight: jest.fn(),
  getTarget: jest.fn().mockReturnValue({})
};

describe('VideoElement certification naming', () => {
  it('names an embedded video by its source', () => {
    const { container } = render(
      <VideoElement
        element={{
          properties: { source_url: 'https://youtu.be/dQw4w9WgXcQ?t=1' },
          styles: {}
        }}
        responsiveStyles={responsiveStyles}
      />
    );
    expect(container.querySelector('iframe')?.getAttribute('name')).toBe(
      'dQw4w9WgXcQ'
    );
  });

  it('names a hosted video by its file', () => {
    const { container } = render(
      <VideoElement
        element={{
          properties: {
            source_url: 'https://cdn.feathery.io/media/promo.mp4',
            source_type: 'video',
            video_extension: 'video/mp4'
          },
          styles: {}
        }}
        responsiveStyles={responsiveStyles}
      />
    );
    expect(container.querySelector('video')?.getAttribute('name')).toBe(
      'promo.mp4'
    );
  });
});
