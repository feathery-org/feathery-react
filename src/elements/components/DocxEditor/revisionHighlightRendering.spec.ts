import { installRevisionHighlightRendering } from './useDocxEditor';

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

describe('revision highlight rendering', () => {
  it('uses a stronger Robin wash for pending changes than confirmed changes', () => {
    expect(renderedWash({ v: 1, source: 'history', pending: true })).toBe(
      'rgba(226, 98, 110, 0.36)'
    );
    expect(renderedWash({ v: 1, source: 'history', confirmed: true })).toBe(
      'rgba(226, 98, 110, 0.22)'
    );
  });

  it('treats a live Robin tracked revision as pending', () => {
    expect(renderedWash({ v: 1, source: 'robin' })).toBe(
      'rgba(226, 98, 110, 0.36)'
    );
  });
});
