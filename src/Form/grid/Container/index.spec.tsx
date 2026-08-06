import { render } from '@testing-library/react';
import { Container } from '.';

// Records the props the real container would register dirty state under
jest.mock(
  '../../../elements/components/DocxEditor/DocumentEditorContainer',
  () => ({
    __esModule: true,
    default: ({ containerId, formId }: any) => (
      <div
        data-testid='docx-editor'
        data-container-id={containerId}
        data-form-id={formId}
      />
    )
  })
);

const docxNode = {
  id: 'container-1',
  key: 'container-1',
  type: 'container',
  isElement: false,
  parent: { styles: { height: 'fit', axis: 'column' } },
  children: [],
  properties: { document_editor: true },
  styles: {
    axis: 'column',
    content_responsive: false,
    height: 200,
    height_unit: 'px',
    width: 'fill',
    width_unit: 'fill'
  }
};

describe('Container document editor wiring', () => {
  // docxDirtyRegistry is keyed by the same id the Form guards Next/Back with,
  // so the editor must be handed the form instance id, not the form's key.
  it('passes the form instance id down as the editor formId', () => {
    const { getByTestId } = render(
      <Container
        node={docxNode}
        viewport='desktop'
        form={{
          formInstanceId: 'internal-form-id',
          activeStep: { id: 'step-1' },
          formSettings: { mobileBreakpoint: 480 }
        }}
      />
    );

    const editor = getByTestId('docx-editor');
    expect(editor).toHaveAttribute('data-form-id', 'internal-form-id');
    expect(editor).toHaveAttribute('data-container-id', 'container-1');
  });
});
