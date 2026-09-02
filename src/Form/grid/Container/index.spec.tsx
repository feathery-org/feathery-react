import { fireEvent, render } from '@testing-library/react';
import { Container } from '.';
import { subscribeToReorderAnnouncements } from '../RepeatReorder/announce';

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

  /** Moves the focused row one step. The arrow keys are the keyboard path. */
  const pressArrow = (grip: HTMLElement, key: 'ArrowUp' | 'ArrowDown') =>
    fireEvent.keyDown(grip, { key, bubbles: true });

  /** Puts the pointer in the top or bottom half of a row's box. */
  const hoverHalf = (row: HTMLElement, half: 'top' | 'bottom') => {
    row.getBoundingClientRect = () =>
      ({ top: 0, bottom: 100, height: 100, left: 0, right: 200 } as DOMRect);
    fireEvent.pointerMove(row, {
      bubbles: true,
      clientY: half === 'top' ? 10 : 90
    });
  };

  /** A press and release with no movement, which is not a drag. */
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

  /** A step whose add-row button caps the container at `maxRepeats` rows. */
  const cappedStep = (maxRepeats: number) => ({
    ...step,
    buttons: [
      {
        properties: {
          actions: [
            {
              type: 'add_repeated_row',
              repeat_container: 'repeat-1',
              max_repeats: maxRepeats
            }
          ]
        }
      }
    ]
  });

  it('withdraws the seam once the container is at the row cap', () => {
    // Three rows of data against a cap of three. Offering a button that
    // insertRepeatedRow will refuse just reads as broken.
    const { queryByLabelText } = renderContainer(
      repeatNode({ repeat: 1 }),
      formProps({ activeStep: cappedStep(3) })
    );
    expect(queryByLabelText('Add a row below row 2')).toBeNull();
  });

  it('keeps the seam while the container is below the row cap', () => {
    const { getByLabelText } = renderContainer(
      repeatNode({ repeat: 1 }),
      formProps({ activeStep: cappedStep(4) })
    );
    expect(getByLabelText('Add a row below row 2')).toBeTruthy();
  });

  /**
   * The `+` sits on the boundary the pointer is actually pointing at, so a
   * filler aiming above a row does not have to reason about which row's seam
   * they are really using. Before this it was always the row's bottom edge, and
   * inserting above the very first row was impossible.
   */
  it('moves the seam to the edge the pointer is nearer', () => {
    const { container, getByLabelText } = renderContainer(
      repeatNode({ repeat: 1 })
    );
    const row = container.querySelector(
      '[data-feathery-repeat-row]'
    ) as HTMLElement;

    expect(getByLabelText('Add a row below row 2')).toBeTruthy();

    hoverHalf(row, 'top');
    expect(getByLabelText('Add a row above row 2')).toBeTruthy();

    hoverHalf(row, 'bottom');
    expect(getByLabelText('Add a row below row 2')).toBeTruthy();
  });

  it('inserts before the row when the seam is above it', () => {
    const form = formProps();
    const { container, getByLabelText } = renderContainer(
      repeatNode({ repeat: 1 }),
      form
    );
    const row = container.querySelector(
      '[data-feathery-repeat-row]'
    ) as HTMLElement;

    hoverHalf(row, 'top');
    getByLabelText('Add a row above row 2').click();
    expect(form.insertRepeatedRow).toHaveBeenCalledWith(step.subgrids[0], 1);
  });

  // Previously nothing could be added ahead of the first row.
  it('can insert ahead of the first row', () => {
    const form = formProps();
    const { container, getByLabelText } = renderContainer(
      repeatNode({ repeat: 0 }),
      form
    );
    const row = container.querySelector(
      '[data-feathery-repeat-row]'
    ) as HTMLElement;

    hoverHalf(row, 'top');
    getByLabelText('Add a row above row 1').click();
    expect(form.insertRepeatedRow).toHaveBeenCalledWith(step.subgrids[0], 0);
  });

  it('gives each row exactly one seam', () => {
    // One button per row, so no boundary ends up with two overlapping controls.
    const { container } = renderContainer(repeatNode({ repeat: 1 }));
    expect(container.querySelectorAll('.feathery-repeat-insert')).toHaveLength(
      1
    );
  });

  // The grip offers no popup. A press that is not a drag just focuses it, which
  // is what makes the arrow keys reachable by pointer.
  it('offers no menu, and a tap focuses the grip instead', () => {
    const { getByLabelText, queryByRole } = renderContainer(repeatNode());
    const grip = getByLabelText('Row 1 of 3');

    tapGrip(grip);

    expect(queryByRole('menu')).toBeNull();
    expect(grip).not.toHaveAttribute('aria-haspopup');
    expect(grip).toHaveFocus();
  });

  it('ignores an arrow key that would run off the end', () => {
    const form = formProps();
    const { getByLabelText } = render(
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

    pressArrow(getByLabelText('Row 1 of 3'), 'ArrowUp');
    pressArrow(getByLabelText('Row 3 of 3'), 'ArrowDown');
    expect(form.moveRepeatedRow).not.toHaveBeenCalled();
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

  // A lone row has nothing to reorder against, but it is still the anchor for
  // adding the second one, so the seam has to survive where the grip does not.
  it('keeps the seam but drops the grip on a single row', () => {
    setFieldValues(['a']);
    const { container, queryByLabelText } = renderContainer(repeatNode());

    expect(container.querySelector('[data-feathery-repeat-row]')).toBeTruthy();
    expect(container.querySelector('.feathery-repeat-insert')).toBeTruthy();
    expect(
      container.querySelector('[data-feathery-reorder-handle]')
    ).toBeNull();
    expect(queryByLabelText('Row 1 of 1')).toBeNull();
  });

  it('adds the second row from a lone row seam', () => {
    setFieldValues(['a']);
    const form = formProps({ visiblePositions: { '0': [true] } });
    const { getByLabelText } = renderContainer(repeatNode(), form);

    getByLabelText('Add a row below row 1').click();
    expect(form.insertRepeatedRow).toHaveBeenCalledWith(step.subgrids[0], 1);
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
    const { getByLabelText } = render(
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

    pressArrow(getByLabelText('Row 1 of 3'), 'ArrowDown');
    expect(form.moveRepeatedRow).toHaveBeenCalledWith(step.subgrids[0], 0, 1);
  });

  it('steps over a hidden row rather than swallowing the keypress', () => {
    // Absolute row 1 is hidden, so "down" from row 0 must reach absolute 2.
    const form = formProps({ visiblePositions: { '0': [true, false, true] } });
    const { getByLabelText } = render(
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

    pressArrow(getByLabelText('Row 1 of 2'), 'ArrowDown');
    expect(form.moveRepeatedRow).toHaveBeenCalledWith(step.subgrids[0], 0, 2);
  });

  /**
   * What a move says out loud has to be the position the handle claims. Read in
   * absolute indices instead, a container with a hidden row told a screen
   * reader "position 3 of 3" about a handle labelled "Row 1 of 2".
   */
  it('announces the position its own label uses', () => {
    const form = formProps({ visiblePositions: { '0': [true, false, true] } });
    const heard: string[] = [];
    const stop = subscribeToReorderAnnouncements('internal-form-id', (m) =>
      heard.push(m)
    );

    const { getByLabelText } = render(
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

    pressArrow(getByLabelText('Row 1 of 2'), 'ArrowDown');
    stop();

    // Absolute row 2 is the second of the two rows on screen.
    expect(heard).toContain('Row moved to position 2 of 2');
  });

  it('describes its handles through its own form instructions node', () => {
    const { getByLabelText } = renderContainer(repeatNode({ repeat: 0 }));

    expect(getByLabelText('Row 1 of 3')).toHaveAttribute(
      'aria-describedby',
      'feathery-repeat-reorder-instructions-internal-form-id'
    );
  });

  it('does not announce into another form on the page', () => {
    const heard: string[] = [];
    const stop = subscribeToReorderAnnouncements('a-different-form', (m) =>
      heard.push(m)
    );

    const form = formProps();
    const { getByLabelText } = render(
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

    pressArrow(getByLabelText('Row 1 of 3'), 'ArrowDown');
    stop();

    expect(heard).toEqual([]);
  });
});
