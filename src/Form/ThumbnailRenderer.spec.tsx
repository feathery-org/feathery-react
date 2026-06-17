import React from 'react';
import { render, screen } from '@testing-library/react';
import ThumbnailRenderer from './ThumbnailRenderer';
import { fieldValues } from '../utils/init';

const mockGrid = jest.fn(({ form }: any) => (
  <div
    data-testid='thumbnail-grid'
    data-read-only={String(form.formSettings.readOnly)}
    data-visible-child={String(form.visiblePositions['0']?.[0])}
  />
));

jest.mock('./grid', () => ({
  Grid: (props: any) => mockGrid(props)
}));

const baseStep = {
  id: 'step-id',
  key: 'step-key',
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
      id: 'child',
      key: 'child',
      position: [0],
      properties: {},
      styles: {},
      mobile_styles: {},
      width: 'fill',
      height: 'fit'
    }
  ],
  texts: [],
  buttons: [],
  servar_fields: [],
  progress_bars: [],
  images: [],
  videos: [],
  tables: []
};

describe('ThumbnailRenderer', () => {
  beforeEach(() => {
    mockGrid.mockClear();
    Object.keys(fieldValues).forEach((key) => {
      delete fieldValues[key];
    });
  });

  it('renders the grid for thumbnail capture', () => {
    render(<ThumbnailRenderer formId='form-id' step={baseStep} />);

    expect(screen.getByTestId('thumbnail-grid')).toHaveAttribute(
      'data-read-only',
      'true'
    );
    expect(screen.getByTestId('thumbnail-grid')).toHaveAttribute(
      'data-visible-child',
      'true'
    );

    const [{ form, step, viewport }] = mockGrid.mock.calls[0];
    expect(step).toBe(baseStep);
    expect(viewport).toBe('desktop');
    expect(form.featheryContext.formId).toBe('form-id');
    expect(form.buttonOnClick()).toBeUndefined();
    expect(form.runElementActions()).toBeUndefined();
    expect(form.fieldOnChange()).toBeInstanceOf(Function);
  });

  it('forces read-only mode even when callers pass mutable form settings', () => {
    render(
      <ThumbnailRenderer
        step={baseStep}
        formSettings={{ readOnly: false, rightToLeft: true }}
      />
    );

    const [{ form }] = mockGrid.mock.calls[0];
    expect(form.formSettings.readOnly).toBe(true);
    expect(form.formSettings.rightToLeft).toBe(true);
  });

  it('uses the current thumbnail values', () => {
    render(
      <ThumbnailRenderer
        step={baseStep}
        values={{ stale_value: 'previous value' }}
      />
    );

    expect(fieldValues).toEqual({ stale_value: 'previous value' });

    render(
      <ThumbnailRenderer
        step={baseStep}
        values={{ current_value: 'current value' }}
      />
    );

    expect(fieldValues).toEqual({ current_value: 'current value' });
  });
});
