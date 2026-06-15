import React from 'react';
import { render, screen } from '@testing-library/react';
import ThumbnailRenderer from './ThumbnailRenderer';
import { featheryWindow } from '../utils/browser';

const step = {
  id: 'step-id',
  key: 'step-key',
  next_conditions: [],
  subgrids: [
    {
      id: 'root',
      key: 'root',
      position: [],
      properties: {},
      styles: {},
      mobile_styles: {},
      width: 'fill',
      height: 'fit'
    },
    {
      id: 'text-position',
      key: 'text-position',
      position: [0],
      properties: {},
      styles: {},
      mobile_styles: {},
      width: 'fill',
      height: 'fit'
    }
  ],
  texts: [
    {
      id: 'text-id',
      key: 'text-id',
      position: [0],
      type: 'text',
      properties: {
        text: 'Thumbnail text',
        text_formatted: [{ insert: 'Thumbnail text', attributes: {} }]
      },
      styles: {},
      mobile_styles: {}
    }
  ],
  buttons: [],
  servar_fields: [],
  progress_bars: [],
  images: [],
  videos: [],
  tables: []
};

describe('ThumbnailRenderer integration', () => {
  beforeAll(() => {
    const browserWindow = featheryWindow();
    browserWindow.matchMedia =
      browserWindow.matchMedia ||
      (() =>
        ({
          matches: false,
          addEventListener: jest.fn(),
          removeEventListener: jest.fn()
        } as any));
  });

  it('renders a visual step for thumbnail capture', () => {
    render(<ThumbnailRenderer formId='form-id' step={step} />);

    expect(screen.getByText('Thumbnail text')).toBeInTheDocument();
  });
});
