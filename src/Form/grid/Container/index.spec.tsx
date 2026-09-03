import { fireEvent, render } from '@testing-library/react';
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

const actionNode = {
  ...docxNode,
  id: 'container-2',
  key: 'plan-card-premium',
  properties: { actions: [{ type: 'next' }] }
};

const form = {
  formInstanceId: 'internal-form-id',
  activeStep: { id: 'step-1' },
  formSettings: { mobileBreakpoint: 480 }
};

describe('Container naming', () => {
  it('names every container by its key, actionable or not', () => {
    const { container } = render(
      <Container
        node={{ ...docxNode, properties: {} }}
        viewport='desktop'
        form={form}
      />
    );
    expect(container.querySelector('[name="container-1"]')).toBeTruthy();
  });
});

describe('Container with actions', () => {
  const renderActionable = () => {
    const runElementActions = jest.fn();
    const utils = render(
      <Container
        node={actionNode}
        viewport='desktop'
        form={form}
        runElementActions={runElementActions}
      />
    );
    const target = utils.container.querySelector(
      '[aria-label="plan-card-premium"]'
    ) as HTMLElement;
    return { ...utils, runElementActions, target };
  };

  it('is named and focusable but carries no button role', () => {
    // role="button" would make every descendant presentational and hide the
    // card's own text and fields from assistive tech
    const { target } = renderActionable();
    expect(target).toBeTruthy();
    expect(target.tabIndex).toBe(0);
    expect(target.getAttribute('role')).toBeNull();
  });

  it('runs its actions on Enter and Space', () => {
    const { target, runElementActions } = renderActionable();
    fireEvent.keyDown(target, { key: 'Enter' });
    fireEvent.keyDown(target, { key: ' ' });
    expect(runElementActions).toHaveBeenCalledTimes(2);
  });

  it('ignores key presses that bubble from nested content', () => {
    const { target, runElementActions } = renderActionable();
    const child = target.ownerDocument.createElement('button');
    target.appendChild(child);
    fireEvent.keyDown(child, { key: 'Enter' });
    expect(runElementActions).not.toHaveBeenCalled();
  });
});

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
