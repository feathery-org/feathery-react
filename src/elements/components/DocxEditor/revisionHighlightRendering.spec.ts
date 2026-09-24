import {
  installRevisionHighlightRendering,
  setActiveInlineRevisions
} from './useDocxEditor';

const robinColor = () => '#e2626e';

function renderedWash(
  customData: Record<string, unknown>,
  revisionType = 'Insertion',
  tableRow = false
): string {
  const fills: string[] = [];
  let fillStyle = '';
  const context = {
    get fillStyle() {
      return fillStyle;
    },
    set fillStyle(value: string) {
      fillStyle = value;
    },
    fillRect: jest.fn(() => fills.push(fillStyle)),
    save: jest.fn(),
    restore: jest.fn(),
    strokeRect: jest.fn(),
    setLineDash: jest.fn()
  };
  const renderer: any = {
    pageContext: context,
    checkRevisionType: jest.fn(),
    getScaledValue: (value: number) => value,
    renderTextElementBox: jest.fn(),
    renderCellBackground: jest.fn(),
    renderWidgets: jest.fn()
  };
  const editor: any = {
    documentHelper: { render: renderer },
    viewer: { visiblePages: [] }
  };
  installRevisionHighlightRendering(editor, robinColor);

  const revision = {
    author: 'robin',
    revisionType,
    customData: JSON.stringify(customData)
  };
  if (tableRow) {
    renderer.renderCellBackground(
      12,
      {
        x: 0,
        y: 0,
        width: 40,
        margin: { top: 0 },
        containerWidget: { topBorderWidth: 0 },
        ownerRow: {
          rowFormat: { revisionLength: 1, getRevision: () => revision }
        }
      },
      0,
      0,
      0
    );
    return fills[0];
  }
  renderer.renderTextElementBox(
    {
      width: 40,
      height: 12,
      margin: { left: 0, top: 0 },
      line: {},
      revisionLength: 1,
      getRevision: () => revision
    },
    0,
    0,
    0
  );
  return fills[0];
}

function renderedOutline(
  customData: Record<string, unknown>,
  active = false,
  historyPreview = false
) {
  const calls: string[] = [];
  let strokeStyle = '';
  const context = {
    fillStyle: '',
    get strokeStyle() {
      return strokeStyle;
    },
    set strokeStyle(value: string) {
      strokeStyle = value;
    },
    lineWidth: 0,
    fillRect: jest.fn(),
    save: jest.fn(),
    restore: jest.fn(),
    strokeRect: jest.fn(() => calls.push(`stroke:${strokeStyle}`)),
    setLineDash: jest.fn((dash: number[]) =>
      calls.push(`dash:${dash.join(',')}`)
    )
  };
  const revision = {
    author: 'robin',
    revisionType: 'Insertion',
    customData: JSON.stringify(customData)
  };
  const elementBox = {
    width: 40,
    height: 12,
    margin: { left: 0, top: 0 },
    line: {},
    revisionLength: 1,
    getRevision: () => revision
  };
  const renderer: any = {
    pageContext: context,
    checkRevisionType: jest.fn(),
    getScaledValue: (value: number) => value,
    renderTextElementBox: jest.fn(),
    renderWidgets: jest.fn(() =>
      renderer.renderTextElementBox(elementBox, 0, 0, 0)
    )
  };
  const editor: any = {
    documentHelper: { render: renderer },
    viewer: { visiblePages: [] }
  };
  installRevisionHighlightRendering(
    editor,
    robinColor,
    historyPreview ? { showPendingOutline: true } : undefined
  );

  if (active) setActiveInlineRevisions(editor, [revision]);
  renderer.renderWidgets({}, 0, 0, 0, 0);
  return { calls, context };
}

describe('revision highlight rendering', () => {
  it.each(['Insertion', 'Deletion'])(
    'uses the approved edit shade for pending %s changes',
    (revisionType) => {
      expect(
        renderedWash({ v: 1, source: 'history', pending: true }, revisionType)
      ).toBe(
        renderedWash({ v: 1, source: 'history', confirmed: true }, revisionType)
      );
    }
  );

  it('uses the same light Robin shade in the live editor', () => {
    expect(renderedWash({ v: 1, source: 'robin' })).toBe(
      'rgba(226, 98, 110, 0.18)'
    );
  });

  it('uses the approved edit shade for pending table rows', () => {
    expect(renderedWash({ v: 1, source: 'robin' }, 'Insertion', true)).toBe(
      renderedWash(
        { v: 1, source: 'history', confirmed: true },
        'Insertion',
        true
      )
    );
  });

  it('does not draw dashed outlines in the live editor', () => {
    expect(renderedOutline({ v: 1, source: 'robin' }).calls).toEqual([]);
  });

  it('retains only the neutral active outline in the live editor', () => {
    expect(renderedOutline({ v: 1, source: 'robin' }, true).calls).toEqual([
      'stroke:rgba(43, 49, 52, 0.34)'
    ]);
  });

  it('draws a 1px author-colored dashed outline in version history', () => {
    const { calls, context } = renderedOutline(
      { v: 1, source: 'history', pending: true },
      false,
      true
    );

    expect(calls).toEqual(['dash:7,4', 'stroke:#e2626e']);
    expect(context.lineWidth).toBe(1);
  });

  it('keeps the history pending dash visible on the active step', () => {
    const { calls } = renderedOutline({ v: 1, source: 'robin' }, true, true);

    expect(calls).toEqual([
      'stroke:rgba(43, 49, 52, 0.34)',
      'dash:7,4',
      'stroke:#e2626e'
    ]);
  });

  it('does not outline approved history edits', () => {
    expect(
      renderedOutline({ v: 1, source: 'history', confirmed: true }, false, true)
        .calls
    ).toEqual([]);
  });
});
