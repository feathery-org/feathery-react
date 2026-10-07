import React from 'react';
import { render } from '@testing-library/react';
import { FormWebMCPTools, hasWebMCPRuntime } from '../webmcp';

const registerTool = jest.fn((tool: any, options: { signal: AbortSignal }) =>
  Promise.resolve()
);

beforeEach(() => {
  registerTool.mockClear();
  (document as any).modelContext = { registerTool };
});

afterEach(() => {
  delete (document as any).modelContext;
});

describe('FormWebMCPTools', () => {
  it('registers the form tools with their annotations', () => {
    render(<FormWebMCPTools formUuid='form-1' />);

    const tools = registerTool.mock.calls.map(([tool]) => tool);
    expect(tools.map((t) => t.name)).toEqual([
      'feathery_get_step',
      'feathery_fill_step',
      'feathery_next_step'
    ]);
    expect(tools[0].annotations).toEqual({
      readOnlyHint: true,
      untrustedContentHint: true
    });
    expect(tools[1].inputSchema.required).toEqual(['values']);
    expect(tools[2].annotations).toEqual({ consequentialHint: true });
  });

  it('aborts the registrations when the form unmounts', () => {
    const { unmount } = render(<FormWebMCPTools formUuid='form-1' />);
    const signals = registerTool.mock.calls.map(
      ([, options]) => options.signal
    );

    unmount();

    expect(signals.every((signal) => signal.aborted)).toBe(true);
  });

  it('still registers the other tools when one registration rejects', async () => {
    registerTool.mockImplementation((tool: any) =>
      tool.name === 'feathery_fill_step'
        ? Promise.reject(new Error('name already registered'))
        : Promise.resolve()
    );
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});

    expect(() => render(<FormWebMCPTools formUuid='form-1' />)).not.toThrow();
    // Let the rejected registerTool promise's .catch handler run.
    await Promise.resolve();
    await Promise.resolve();

    expect(registerTool.mock.calls.map(([tool]) => tool.name)).toEqual([
      'feathery_get_step',
      'feathery_fill_step',
      'feathery_next_step'
    ]);
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('feathery_fill_step'),
      expect.any(Error)
    );
    warnSpy.mockRestore();
    registerTool.mockImplementation(() => Promise.resolve());
  });
});

describe('hasWebMCPRuntime', () => {
  it('is false without document.modelContext', () => {
    delete (document as any).modelContext;
    expect(hasWebMCPRuntime()).toBe(false);
  });

  it('is true once a runtime is installed', () => {
    expect(hasWebMCPRuntime()).toBe(true);
  });
});
