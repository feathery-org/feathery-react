import { isDocusignSignAction } from '../document';

describe('isDocusignSignAction', () => {
  it('returns true when the action is configured for docusign sign', () => {
    expect(isDocusignSignAction({ sign_method: 'docusign' })).toBe(true);
  });

  it('returns false when sign_method is feathery (regression)', () => {
    expect(isDocusignSignAction({ sign_method: 'feathery' })).toBe(false);
  });

  it('returns false when sign_method is absent (regression)', () => {
    expect(isDocusignSignAction({})).toBe(false);
  });

  it('returns false for an unrecognized sign_method value', () => {
    expect(isDocusignSignAction({ sign_method: 'something-else' })).toBe(false);
  });
});
