import { stepPageKey, trapTabKey } from './keyboard';

describe('stepPageKey', () => {
  const order = ['a', 'b', 'c'];
  it('steps forward and backward', () => {
    expect(stepPageKey(order, 'a', 1)).toBe('b');
    expect(stepPageKey(order, 'b', -1)).toBe('a');
  });
  it('returns null at the edges and for empty lists', () => {
    expect(stepPageKey(order, 'c', 1)).toBeNull();
    expect(stepPageKey(order, 'a', -1)).toBeNull();
    expect(stepPageKey([], '', 1)).toBeNull();
  });
  it('defaults to the first page when active is unknown', () => {
    expect(stepPageKey(order, '', 1)).toBe('a');
  });
});

describe('trapTabKey', () => {
  const setup = () => {
    document.body.innerHTML =
      '<div id="c"><button id="first">A</button><button id="last">B</button></div>';
    return document.getElementById('c') as HTMLElement;
  };
  it('wraps focus from last to first on Tab', () => {
    const container = setup();
    (document.getElementById('last') as HTMLElement).focus();
    const e = { shiftKey: false, preventDefault: jest.fn() };
    trapTabKey(container, e);
    expect(e.preventDefault).toHaveBeenCalled();
    expect(document.activeElement?.id).toBe('first');
  });
  it('wraps focus from first to last on Shift+Tab', () => {
    const container = setup();
    (document.getElementById('first') as HTMLElement).focus();
    const e = { shiftKey: true, preventDefault: jest.fn() };
    trapTabKey(container, e);
    expect(document.activeElement?.id).toBe('last');
  });
});
