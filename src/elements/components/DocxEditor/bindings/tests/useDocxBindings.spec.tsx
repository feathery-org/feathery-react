// The hook decides only WHEN to attach. attachBindings is mocked here so these
// assertions are about that decision - never before a document is open, never to
// a read-only one, never at all when disabled, and always torn down with the
// instance it was attached to.
import React from 'react';
import { render } from '@testing-library/react';
import { attachBindings } from '../attachBindings';
import { useDocxBindings, UseDocxBindingsOptions } from '../useDocxBindings';

jest.mock('../attachBindings', () => ({
  attachBindings: jest.fn()
}));

const attachMock = attachBindings as jest.MockedFunction<typeof attachBindings>;

function makeAttached() {
  return {
    controller: {} as any,
    commitForSave: jest.fn(() => true),
    diagnostics: jest.fn(() => []),
    fieldValues: jest.fn(() => ({ 'project.name': 'Acme' })),
    importDiagnostics: [],
    dispose: jest.fn()
  };
}

function Harness(props: UseDocxBindingsOptions) {
  const state = useDocxBindings(props);
  return <div data-testid='state'>{state.ready ? 'ready' : 'idle'}</div>;
}

const editor = { serialize: () => '{}', open: () => {} } as any;

describe('useDocxBindings', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    attachMock.mockImplementation(() => makeAttached() as any);
  });

  it('does nothing at all when disabled', () => {
    const { getByTestId } = render(
      <Harness enabled={false} editor={editor} loading={false} />
    );
    expect(attachMock).not.toHaveBeenCalled();
    expect(getByTestId('state').textContent).toBe('idle');
  });

  it('waits for the document to finish opening', () => {
    const { rerender, getByTestId } = render(
      <Harness enabled editor={editor} loading />
    );
    // Attaching mid-open would reconcile a document that is still arriving.
    expect(attachMock).not.toHaveBeenCalled();

    rerender(<Harness enabled editor={editor} loading={false} />);
    expect(attachMock).toHaveBeenCalledTimes(1);
    expect(getByTestId('state').textContent).toBe('ready');
  });

  it('leaves a read-only document alone', () => {
    // Reconciliation writes to the document, and a signed or finalized envelope
    // is not ours to rewrite.
    render(<Harness enabled editor={editor} loading={false} readOnly />);
    expect(attachMock).not.toHaveBeenCalled();
  });

  it('waits for an editor to exist', () => {
    render(<Harness enabled editor={null} loading={false} />);
    expect(attachMock).not.toHaveBeenCalled();
  });

  it('detaches on unmount', () => {
    const attached = makeAttached();
    attachMock.mockImplementation(() => attached as any);
    const { unmount } = render(
      <Harness enabled editor={editor} loading={false} />
    );
    expect(attached.dispose).not.toHaveBeenCalled();
    unmount();
    expect(attached.dispose).toHaveBeenCalledTimes(1);
  });

  it('reattaches when the editor instance is replaced', () => {
    // The host recreates its instance whenever review mode flips; bindings
    // installed on the old one are gone with it.
    const first = makeAttached();
    const second = makeAttached();
    attachMock.mockImplementationOnce(() => first as any);
    attachMock.mockImplementationOnce(() => second as any);

    const { rerender } = render(
      <Harness enabled editor={editor} loading={false} />
    );
    const replacement = { serialize: () => '{}', open: () => {} } as any;
    rerender(<Harness enabled editor={replacement} loading={false} />);

    expect(first.dispose).toHaveBeenCalledTimes(1);
    expect(attachMock).toHaveBeenCalledTimes(2);
  });

  it('reports blocked when diagnostics contain an error', () => {
    const attached = makeAttached();
    attached.diagnostics = jest.fn(() => [
      { severity: 'error', code: 'invalid-input', message: 'nope', path: [] }
    ]) as any;
    attachMock.mockImplementation(() => attached as any);

    let blocked: boolean | null = null;
    function Probe() {
      const state = useDocxBindings({ enabled: true, editor, loading: false });
      blocked = state.blocked;
      return null;
    }
    render(<Probe />);
    expect(blocked).toBe(true);
  });

  it('survives an attach failure without taking the editor down', () => {
    attachMock.mockImplementation(() => {
      throw new Error('unreadable document');
    });
    const consoleError = jest
      .spyOn(console, 'error')
      .mockImplementation(() => {});

    const { getByTestId } = render(
      <Harness enabled editor={editor} loading={false} />
    );

    // The editor keeps working; bindings simply are not live.
    expect(getByTestId('state').textContent).toBe('idle');
    expect(consoleError).toHaveBeenCalled();
    consoleError.mockRestore();
  });
});
