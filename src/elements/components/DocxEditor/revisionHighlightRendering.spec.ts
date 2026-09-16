import {
  installRevisionHighlightRendering,
  setActiveInlineRevisions
} from './useDocxEditor';

const robinColor = () => '#e2626e';

function renderedWash(customData: Record<string, unknown>): string {
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
    renderWidgets: jest.fn()
  };
  const editor: any = {
    documentHelper: { render: renderer },
    viewer: { visiblePages: [] }
  };
  installRevisionHighlightRendering(editor, robinColor);

  const revision = {
    author: 'robin',
    revisionType: 'Insertion',
    customData: JSON.stringify(customData)
  };
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

function renderedOutline(customData: Record<string, unknown>, active = false) {
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
  installRevisionHighlightRendering(editor, robinColor);

  if (active) setActiveInlineRevisions(editor, [revision]);
  renderer.renderWidgets({}, 0, 0, 0, 0);
  return { calls, context };
}

describe('revision highlight rendering', () => {
  it('uses a stronger Robin wash for pending changes than confirmed changes', () => {
    expect(renderedWash({ v: 1, source: 'history', pending: true })).toBe(
      'rgba(226, 98, 110, 0.42)'
    );
    expect(renderedWash({ v: 1, source: 'history', confirmed: true })).toBe(
      'rgba(226, 98, 110, 0.18)'
    );
  });

  it('treats a live Robin tracked revision as pending', () => {
    expect(renderedWash({ v: 1, source: 'robin' })).toBe(
      'rgba(226, 98, 110, 0.42)'
    );
  });

  it('draws a visible dashed outline around a pending Robin revision', () => {
    const { calls, context } = renderedOutline({ v: 1, source: 'robin' });

    expect(calls).toEqual(['dash:7,4', 'stroke:#e2626e']);
    expect(context.lineWidth).toBe(3);
  });

  it('keeps the pending dash visible when that revision is the active step', () => {
    const { calls } = renderedOutline({ v: 1, source: 'robin' }, true);

    expect(calls).toEqual([
      'stroke:rgba(43, 49, 52, 0.34)',
      'dash:7,4',
      'stroke:#e2626e'
    ]);
  });
});
