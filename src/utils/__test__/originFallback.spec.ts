/**
 * A form whose steps all have origin=false used to resolve to an empty step
 * key, so the SDK rendered nothing and logged nothing - the form simply came up
 * blank. Falling back to the first step is a guess, but a visible one, and the
 * warning says so.
 */
import { getOrigin, getInitialStep } from '../stepHelperFunctions';

const step = (key: string, origin = false) => ({ key, origin });

describe('getOrigin', () => {
  let warn: jest.SpyInstance;
  beforeEach(() => {
    warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
  });
  afterEach(() => warn.mockRestore());

  it('returns the step flagged as the origin', () => {
    const steps = { a: step('a'), b: step('b', true) };
    expect((getOrigin(steps) as any).key).toBe('b');
    expect(warn).not.toHaveBeenCalled();
  });

  it('falls back to the first step when none is flagged', () => {
    const steps = { a: step('a'), b: step('b') };
    expect((getOrigin(steps) as any).key).toBe('a');
  });

  it('warns so the misconfiguration is visible', () => {
    getOrigin({ a: step('a') });
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('no origin step')
    );
  });

  it('still yields an empty key when there are no steps at all', () => {
    // A disabled form legitimately has none, and must not warn about it.
    expect((getOrigin({}) as any).key).toBe('');
    expect(warn).not.toHaveBeenCalled();
  });
});

describe('getInitialStep', () => {
  it('reaches a renderable step when no origin is flagged', () => {
    const key = getInitialStep({
      initialStepId: '',
      steps: { a: step('a'), b: step('b') }
    });
    expect(key).toBe('a');
  });

  it('still prefers an explicit initial step', () => {
    const key = getInitialStep({
      initialStepId: 'b',
      steps: { a: step('a', true), b: step('b') }
    });
    expect(key).toBe('b');
  });
});
