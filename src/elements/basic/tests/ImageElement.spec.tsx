import { render, screen, waitFor } from '@testing-library/react';
import { getRenderData } from '../../../utils/image';
import { fieldValues } from '../../../utils/init';
import { PLACEHOLDER_IMAGE } from '../ImageElement';

jest.mock('../../../utils/image', () => ({
  getRenderData: jest.fn()
}));

const mockResponsiveStyles = {
  addTargets: jest.fn(),
  applyCorners: jest.fn(),
  applyWidth: jest.fn(),
  getTarget: jest.fn().mockReturnValue({})
};

describe('ImageElement', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('renders placeholder image in edit mode if no source image', async () => {
    const mockElement = {
      properties: {
        uploaded_image_file_field_key: 'imageKey',
        aria_label: 'Test Image',
        source_image: ''
      },
      repeat: 0
    };

    const ImageElement = (await import('../ImageElement')).default;

    render(
      <ImageElement
        element={mockElement}
        responsiveStyles={mockResponsiveStyles}
        editMode
      />
    );

    await waitFor(() => {
      const img = screen.getByRole('img');
      expect(img.getAttribute('src')).toEqual(PLACEHOLDER_IMAGE);
    });
  });

  it('renders placeholder image in edit mode if field source is empty', async () => {
    fieldValues.imageKey = '';

    const mockElement = {
      properties: {
        uploaded_image_file_field_key: 'imageKey',
        aria_label: 'Test Image',
        source_image: ''
      },
      repeat: 0
    };

    const ImageElement = (await import('../ImageElement')).default;

    render(
      <ImageElement
        element={mockElement}
        responsiveStyles={mockResponsiveStyles}
        editMode
      />
    );

    await waitFor(() => {
      const img = screen.getByRole('img');
      expect(img.getAttribute('src')).toEqual(PLACEHOLDER_IMAGE);
    });
  });

  it('renders placeholder image in edit mode if field image source is empty', async () => {
    const imageKey = {
      type: 'image/jpeg blob:',
      url: ''
    };

    fieldValues.imageKey = imageKey;

    const mockElement = {
      properties: {
        uploaded_image_file_field_key: 'imageKey',
        aria_label: 'Test Image',
        source_image: ''
      },
      repeat: 0
    };

    (getRenderData as jest.Mock).mockResolvedValue(imageKey);

    const ImageElement = (await import('../ImageElement')).default;

    render(
      <ImageElement
        element={mockElement}
        responsiveStyles={mockResponsiveStyles}
        editMode
      />
    );

    await waitFor(() => {
      const img = screen.getByRole('img');
      expect(img.getAttribute('src')).toEqual(PLACEHOLDER_IMAGE);
    });
  });

  it('renders placeholder image in edit mode if field pdf source is empty', async () => {
    const pdfKey = {
      type: 'application/pdf',
      url: ''
    };

    fieldValues.pdfKey = pdfKey;

    const mockElement = {
      properties: {
        uploaded_image_file_field_key: 'pdfKey',
        aria_label: 'Test PDF'
      },
      repeat: 0
    };

    (getRenderData as jest.Mock).mockResolvedValue(pdfKey);

    const ImageElement = (await import('../ImageElement')).default;

    render(
      <ImageElement
        element={mockElement}
        responsiveStyles={mockResponsiveStyles}
        editMode
      />
    );

    await waitFor(() => {
      const img = screen.getByRole('img');
      expect(img.getAttribute('src')).toEqual(PLACEHOLDER_IMAGE);
    });
  });

  it('renders with provided string image field source', async () => {
    const sourceImg = 'https://example.com/image.png';

    fieldValues.imageKey = sourceImg;

    const mockElement = {
      properties: {
        uploaded_image_file_field_key: 'imageKey',
        aria_label: 'Test Image',
        source_image: ''
      },
      repeat: 0
    };

    const ImageElement = (await import('../ImageElement')).default;

    render(
      <ImageElement
        element={mockElement}
        responsiveStyles={mockResponsiveStyles}
      />
    );

    const img = screen.getByRole('img');
    expect(img).toHaveAttribute('src', expect.stringContaining(sourceImg));
  });

  it('renders image when documentType is image', async () => {
    const imageKey = {
      type: 'image/jpeg blob:',
      url: 'https://example.com/image.png'
    };

    fieldValues.imageKey = imageKey;

    const mockElement = {
      properties: {
        uploaded_image_file_field_key: 'imageKey',
        aria_label: 'Test Image'
      },
      repeat: 0
    };

    (getRenderData as jest.Mock).mockResolvedValue(imageKey);

    const ImageElement = (await import('../ImageElement')).default;

    render(
      <ImageElement
        element={mockElement}
        responsiveStyles={mockResponsiveStyles}
      />
    );

    await waitFor(() => {
      const img = screen.getByRole('img');
      expect(img).toHaveAttribute('src', expect.stringContaining(imageKey.url));
    });
  });

  it('renders pdf when documentType is application/pdf', async () => {
    const pdfKey = {
      type: 'application/pdf',
      url: 'https://example.com/doc.pdf'
    };

    fieldValues.pdfKey = pdfKey;

    const mockFieldKey = 'pdfKey';

    const mockElement = {
      properties: {
        uploaded_image_file_field_key: mockFieldKey,
        aria_label: 'Test PDF'
      },
      repeat: 0
    };

    mockElement.properties.uploaded_image_file_field_key = mockFieldKey;

    (getRenderData as jest.Mock).mockResolvedValue(pdfKey);

    const ImageElement = (await import('../ImageElement')).default;

    mockElement.properties.uploaded_image_file_field_key = mockFieldKey;

    render(
      <ImageElement
        element={mockElement}
        responsiveStyles={mockResponsiveStyles}
      />
    );

    await waitFor(() => {
      const embed = screen.getByLabelText(/Test PDF/i);
      expect(embed.tagName.toLowerCase()).toBe('embed');
      expect(embed).toHaveAttribute('src', expect.stringContaining(pdfKey.url));
    });
  });
});
