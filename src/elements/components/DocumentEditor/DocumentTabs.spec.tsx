import React from 'react';
import { act, fireEvent, render } from '@testing-library/react';
import DocumentTabs from './DocumentTabs';
import { visibleDocumentTabs } from './documentTabOverflow';

it('fits the active tab’s width when pinning it from overflow', () => {
  expect(visibleDocumentTabs([80, 80, 80, 230], 400, 3, 100)).toEqual([3]);
  expect(visibleDocumentTabs([80, 80, 80, 230], 450, 3, 100)).toEqual([0, 3]);
  expect(visibleDocumentTabs([80, 80, 80, 230], 600, 3, 100)).toEqual([
    0, 1, 2, 3
  ]);
  expect(visibleDocumentTabs([240, 240], 200, 1, 100)).toEqual([1]);
});

it('collapses tabs on resize, selects overflow with the keyboard, and pins the selected document', () => {
  let width = 420;
  let resized: () => void = () => {};
  const oldObserver = global.ResizeObserver;
  global.ResizeObserver = class {
    constructor(cb: () => void) {
      resized = cb;
    }

    observe() {}
    disconnect() {}
    unobserve() {}
  } as any;
  const rect = jest
    .spyOn(HTMLElement.prototype, 'getBoundingClientRect')
    .mockImplementation(function (this: HTMLElement) {
      return {
        width: this.hasAttribute('data-measure-tab') ? 120 : 100,
        left: 0,
        right: 100,
        bottom: 40
      } as DOMRect;
    });
  const clientWidth = jest
    .spyOn(HTMLElement.prototype, 'clientWidth', 'get')
    .mockImplementation(() => width);
  const tabs = Array.from({ length: 8 }, (_, i) => ({
    id: `${i}`,
    label: `Document ${i + 1}.docx`
  }));
  const onSelect = jest.fn();
  const props = {
    tabs,
    activeId: '0',
    disabled: false,
    onSelect,
    id: 'packet'
  };
  const view = render(<DocumentTabs {...props} />);
  try {
    expect(view.getAllByRole('tab')).toHaveLength(2);
    fireEvent.click(view.getByRole('button', { name: 'More documents' }));
    const items = view.getAllByRole('menuitem');
    expect(items).toHaveLength(6);
    expect(globalThis.document.activeElement).toBe(items[0]);
    fireEvent.keyDown(items[0], { key: 'End' });
    expect(globalThis.document.activeElement).toBe(items[5]);
    fireEvent.click(items[5]);
    expect(onSelect).toHaveBeenCalledWith('7');
    view.rerender(<DocumentTabs {...props} activeId='7' />);
    expect(view.queryByRole('menu')).toBeNull();
    expect(view.getAllByRole('tab').map((tab) => tab.textContent)).toEqual([
      'Document 1.docx',
      'Document 8.docx'
    ]);
    expect(globalThis.document.activeElement).toBe(
      view.getByRole('tab', { selected: true })
    );
    fireEvent.click(view.getByRole('button', { name: 'More documents' }));
    fireEvent.keyDown(view.getAllByRole('menuitem')[0], { key: 'Escape' });
    expect(view.queryByRole('menu')).toBeNull();
    expect(globalThis.document.activeElement).toBe(
      view.getByRole('button', { name: 'More documents' })
    );
    width = 1200;
    act(() => resized());
    expect(view.getAllByRole('tab')).toHaveLength(8);
    expect(view.queryByRole('button', { name: 'More documents' })).toBeNull();
    width = 240;
    act(() => resized());
    expect(view.getAllByRole('tab')).toHaveLength(1);
    expect(view.getByRole('tab', { selected: true }).textContent).toBe(
      'Document 8.docx'
    );
    view.rerender(<DocumentTabs {...props} activeId='7' disabled />);
    fireEvent.click(view.getByRole('button', { name: 'More documents' }));
    expect(view.queryByRole('menu')).toBeNull();
  } finally {
    view.unmount();
    rect.mockRestore();
    clientWidth.mockRestore();
    global.ResizeObserver = oldObserver;
  }
});
