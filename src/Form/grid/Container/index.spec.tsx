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

/**
 * The handle is gated hard, because every rejected case is one where a visible
 * drag affordance would either do nothing or corrupt the row alignment behind
 * it. Container mounts it unconditionally and lets useRepeatRowReorder decide.
 */
describe('Container repeat row reorder handle', () => {
  const repeatNode = (overrides: any = {}) => ({
    id: 'repeat-1',
    key: 'repeat-1',
    type: 'container',
    isElement: false,
    position: [0],
    parent: {
      styles: { height: 'fit', axis: 'column' },
      children: [{ id: 'repeat-1' }]
    },
    children: [],
    repeatRoot: true,
    repeat: 0,
    properties: { reorderable: true },
    styles: { axis: 'column', width: 'fill', width_unit: 'fill' },
    ...overrides
  });

  const step = {
    id: 'step-1',
    subgrids: [{ id: 'repeat-1', position: [0], repeated: true }],
    servar_fields: [
      {
        servar: { key: 'name', type: 'text_field', repeated: true },
        position: [0, 0]
      }
    ]
  };

  const formProps = (overrides: any = {}) => ({
    formInstanceId: 'internal-form-id',
    activeStep: step,
    formSettings: { mobileBreakpoint: 480 },
    visiblePositions: { '0': [true, true, true] },
    buttonLoaders: {},
    moveRepeatedRow: jest.fn().mockReturnValue(true),
    insertRepeatedRow: jest.fn().mockReturnValue(true),
    ...overrides
  });

  const setFieldValues = (values: string[]) => {
    const init = jest.requireActual('../../../utils/init');
    init.fieldValues.name = values;
  };

  beforeAll(() => {
    (global as any).ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    };
    // jsdom ships no PointerEvent, so testing-library would fall back to a bare
    // Event and drop the pointerId the drag hook reads.
    (globalThis as any).PointerEvent = class extends MouseEvent {
      pointerId: number;
      pointerType: string;
      constructor(type: string, props: any = {}) {
        super(type, props);
        this.pointerId = props.pointerId ?? 0;
        this.pointerType = props.pointerType ?? 'mouse';
      }
    };
    (HTMLElement.prototype as any).setPointerCapture = jest.fn();
    (HTMLElement.prototype as any).releasePointerCapture = jest.fn();
  });

  /** A press and release with no movement, which is what opens the menu. */
  const tapGrip = (grip: HTMLElement) => {
    fireEvent.pointerDown(grip, {
      bubbles: true,
      pointerId: 1,
      clientX: 0,
      clientY: 0
    });
    fireEvent.pointerUp(grip, {
      bubbles: true,
      pointerId: 1,
      clientX: 0,
      clientY: 0
    });
  };

  beforeEach(() => setFieldValues(['a', 'b', 'c']));

  const renderContainer = (node: any, form: any = formProps()) =>
    render(<Container node={node} viewport='desktop' form={form} />);

  it('marks the row with its absolute repeat index', () => {
    const { container } = renderContainer(repeatNode({ repeat: 2 }));
    expect(
      container.querySelector('[data-feathery-repeat-row="2"]')
    ).toBeTruthy();
  });

  it('renders only a grip until it is asked for more', () => {
    // The persistent up/down buttons are gone; the move options live behind the
    // grip so a resting row shows one affordance instead of three.
    const { getByLabelText, queryByRole, container } = renderContainer(
      repeatNode()
    );
    expect(getByLabelText('Row 1 of 3')).toBeTruthy();
    expect(queryByRole('menu')).toBeNull();
    expect(
      container.querySelector('.feathery-repeat-reorder-badge')
    ).toBeNull();
  });

  it('hangs its chrome off the outer box, not the content', () => {
    // Anchored to .inner-container it would drift inward as the border and
    // padding grow, and end up drawn over the outline.
    const { container } = renderContainer(repeatNode());
    const outer = container.querySelector('[data-feathery-repeat-row]');
    const cluster = container.querySelector('.feathery-repeat-reorder');
    expect(cluster?.parentElement).toBe(outer);
    // Not `closest`: in a real form the row itself sits inside its parent
    // container's inner div, so the only meaningful check is that the chrome
    // is outside this row's own content box.
    const ownInner = outer?.querySelector('.inner-container');
    expect(ownInner?.contains(cluster as Node)).toBe(false);
  });

  it.each([
    ['0px', '-28px'],
    ['14px', '-42px']
  ])('clears a %s outline by sitting at %s', (border, expected) => {
    // An absolute offset is measured from the padding box, which sits inside
    // the border, so a static gutter is swallowed by a heavy outline.
    const win: any = globalThis;
    const real = win.getComputedStyle;
    jest
      .spyOn(win, 'getComputedStyle')
      .mockImplementation((el: any, pseudo?: any) => {
        const style = real.call(win, el, pseudo);
        if (!el?.hasAttribute?.('data-feathery-repeat-row')) return style;
        return { ...style, borderInlineStartWidth: border } as any;
      });

    const { container } = renderContainer(repeatNode());
    const cluster = container.querySelector(
      '.feathery-repeat-reorder'
    ) as HTMLElement;

    expect(cluster.style.insetInlineStart).toBe(expected);
    win.getComputedStyle.mockRestore();
  });

  it('offers an insert seam below every row', () => {
    const { getByLabelText } = renderContainer(repeatNode({ repeat: 1 }));
    expect(getByLabelText('Add a row below row 2')).toBeTruthy();
  });

  it('inserts directly beneath the row the seam belongs to', () => {
    const form = formProps();
    const { getByLabelText } = renderContainer(repeatNode({ repeat: 1 }), form);

    getByLabelText('Add a row below row 2').click();
    expect(form.insertRepeatedRow).toHaveBeenCalledWith(step.subgrids[0], 2);
  });

  it('appends from the last row seam', () => {
    const form = formProps();
    const { getByLabelText } = renderContainer(repeatNode({ repeat: 2 }), form);

    getByLabelText('Add a row below row 3').click();
    expect(form.insertRepeatedRow).toHaveBeenCalledWith(step.subgrids[0], 3);
  });

  it('gives each row exactly one seam', () => {
    // One button per row, so no boundary ends up with two overlapping controls.
    const { container } = renderContainer(repeatNode({ repeat: 1 }));
    expect(container.querySelectorAll('.feathery-repeat-insert')).toHaveLength(
      1
    );
  });

  it('opens the move menu when the grip is tapped', () => {
    const { getByLabelText, getByRole } = renderContainer(repeatNode());
    const grip = getByLabelText('Row 1 of 3');

    expect(grip).toHaveAttribute('aria-expanded', 'false');
    tapGrip(grip);

    expect(getByRole('menu')).toBeTruthy();
    expect(grip).toHaveAttribute('aria-expanded', 'true');
  });

  it('disables the move option that would run off the end', () => {
    const first = renderContainer(repeatNode({ repeat: 0 }));
    tapGrip(first.getByLabelText('Row 1 of 3'));
    expect(first.getByText('Move up')).toBeDisabled();
    expect(first.getByText('Move down')).not.toBeDisabled();
    first.unmount();

    const last = renderContainer(repeatNode({ repeat: 2 }));
    tapGrip(last.getByLabelText('Row 3 of 3'));
    expect(last.getByText('Move down')).toBeDisabled();
  });

  it('numbers the badge by rendered position, not absolute index', () => {
    // Absolute row 1 is hidden, so absolute row 2 is what the user calls row 2.
    const form = formProps({ visiblePositions: { '0': [true, false, true] } });
    const { getByLabelText } = renderContainer(repeatNode({ repeat: 2 }), form);
    expect(getByLabelText('Row 2 of 2')).toBeTruthy();
  });

  it('is absent without the reorderable property', () => {
    const { container } = renderContainer(
      repeatNode({ properties: { reorderable: false } })
    );
    expect(container.querySelector('[data-feathery-repeat-row]')).toBeNull();
  });

  it('is absent on a descendant that merely inherited the repeat index', () => {
    const { container } = renderContainer(repeatNode({ repeatRoot: false }));
    expect(container.querySelector('[data-feathery-repeat-row]')).toBeNull();
  });

  it('is absent on the phantom trailing row a set_value trigger renders', () => {
    const { container } = renderContainer(repeatNode({ repeat: 3 }));
    expect(container.querySelector('[data-feathery-repeat-row]')).toBeNull();
  });

  it('is absent when the container holds a single row', () => {
    setFieldValues(['a']);
    const { container } = renderContainer(repeatNode());
    expect(container.querySelector('[data-feathery-repeat-row]')).toBeNull();
  });

  it('is absent on a fixed container, which renders itself twice', () => {
    const { container } = renderContainer(
      repeatNode({
        styles: { axis: 'column', position: 'fixed' },
        mobile_styles: { position: 'fixed' }
      })
    );
    expect(container.querySelector('[data-feathery-repeat-row]')).toBeNull();
  });

  it('is absent while a submit is in flight', () => {
    const form = formProps({ buttonLoaders: { 'button-1': { repeat: 0 } } });
    const { container } = renderContainer(repeatNode(), form);
    expect(container.querySelector('[data-feathery-repeat-row]')).toBeNull();
  });

  it('is absent when the row count comes only from text variables', () => {
    const form = formProps({
      activeStep: { ...step, servar_fields: [] }
    });
    const { container } = renderContainer(repeatNode(), form);
    expect(container.querySelector('[data-feathery-repeat-row]')).toBeNull();
  });

  it('routes a move through the form with the container from the step', () => {
    const form = formProps();
    // All three rows have to be in the DOM: the move steps by rendered
    // position, so a lone row has nothing to step onto.
    const { getByLabelText, getByText } = render(
      <div>
        {[0, 1, 2].map((repeat) => (
          <Container
            key={repeat}
            node={repeatNode({ repeat })}
            viewport='desktop'
            form={form}
          />
        ))}
      </div>
    );

    tapGrip(getByLabelText('Row 1 of 3'));
    getByText('Move down').click();
    expect(form.moveRepeatedRow).toHaveBeenCalledWith(step.subgrids[0], 0, 1);
  });

  it('steps over a hidden row rather than swallowing the keypress', () => {
    // Absolute row 1 is hidden, so "down" from row 0 must reach absolute 2.
    const form = formProps({ visiblePositions: { '0': [true, false, true] } });
    const { getByLabelText, getByText } = render(
      <div>
        {[0, 2].map((repeat) => (
          <Container
            key={repeat}
            node={repeatNode({ repeat })}
            viewport='desktop'
            form={form}
          />
        ))}
      </div>
    );

    tapGrip(getByLabelText('Row 1 of 2'));
    getByText('Move down').click();
    expect(form.moveRepeatedRow).toHaveBeenCalledWith(step.subgrids[0], 0, 2);
  });
});
