import { featheryWindow } from '../../../utils/browser';
import {
  _clearDocxDirtyRegistry,
  clearDocxEditorDirty,
  hasDirtyDocxEditors,
  setDocxEditorDirty
} from './docxDirtyRegistry';

describe('docxDirtyRegistry', () => {
  let addSpy: jest.SpyInstance;
  let removeSpy: jest.SpyInstance;

  beforeEach(() => {
    _clearDocxDirtyRegistry();
    addSpy = jest.spyOn(featheryWindow(), 'addEventListener');
    removeSpy = jest.spyOn(featheryWindow(), 'removeEventListener');
  });

  afterEach(() => {
    _clearDocxDirtyRegistry();
    jest.restoreAllMocks();
  });

  const unloadCalls = (spy: jest.SpyInstance) =>
    spy.mock.calls.filter(([event]) => event === 'beforeunload');

  it('tracks dirty state per form', () => {
    expect(hasDirtyDocxEditors('form-1')).toBe(false);

    setDocxEditorDirty('form-1', 'container-a', true);
    expect(hasDirtyDocxEditors('form-1')).toBe(true);
    expect(hasDirtyDocxEditors('form-2')).toBe(false);

    setDocxEditorDirty('form-1', 'container-a', false);
    expect(hasDirtyDocxEditors('form-1')).toBe(false);
  });

  it('stays dirty until every editor on the form is clean', () => {
    setDocxEditorDirty('form-1', 'container-a', true);
    setDocxEditorDirty('form-1', 'container-b', true);

    setDocxEditorDirty('form-1', 'container-a', false);
    expect(hasDirtyDocxEditors('form-1')).toBe(true);

    clearDocxEditorDirty('form-1', 'container-b');
    expect(hasDirtyDocxEditors('form-1')).toBe(false);
  });

  it('falls back to a shared key when formId is undefined', () => {
    setDocxEditorDirty(undefined, 'container-a', true);
    expect(hasDirtyDocxEditors()).toBe(true);
    expect(hasDirtyDocxEditors('form-1')).toBe(false);

    clearDocxEditorDirty(undefined, 'container-a');
    expect(hasDirtyDocxEditors()).toBe(false);
  });

  it('attaches the beforeunload listener only on the 0 -> dirty transition', () => {
    setDocxEditorDirty('form-1', 'container-a', true);
    setDocxEditorDirty('form-1', 'container-b', true);
    setDocxEditorDirty('form-2', 'container-c', true);

    expect(unloadCalls(addSpy)).toHaveLength(1);
    expect(unloadCalls(removeSpy)).toHaveLength(0);
  });

  it('removes the beforeunload listener when the last dirty editor clears', () => {
    setDocxEditorDirty('form-1', 'container-a', true);
    setDocxEditorDirty('form-2', 'container-b', true);

    setDocxEditorDirty('form-1', 'container-a', false);
    expect(unloadCalls(removeSpy)).toHaveLength(0);

    setDocxEditorDirty('form-2', 'container-b', false);
    expect(unloadCalls(removeSpy)).toHaveLength(1);
  });

  it('prevents unload while dirty', () => {
    setDocxEditorDirty('form-1', 'container-a', true);

    const handler = unloadCalls(addSpy)[0][1] as (event: any) => void;
    const event = { preventDefault: jest.fn(), returnValue: undefined };
    handler(event);
    expect(event.preventDefault).toHaveBeenCalled();
    expect(event.returnValue).toBe(true);
  });
});
