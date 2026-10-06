import { getInitialStep } from './stepHelperFunctions';

describe('getInitialStep', () => {
  const steps = {
    intro: { key: 'intro', origin: true },
    details: { key: 'details', origin: false },
    review: { key: 'review', origin: false }
  };

  it('falls back to the origin step when nothing else is set', () => {
    expect(getInitialStep({ initialStepId: '', steps })).toBe('intro');
  });

  it('uses the collaborator start step over the origin step', () => {
    expect(
      getInitialStep({
        initialStepId: '',
        steps,
        collaboratorStartStep: 'details'
      })
    ).toBe('details');
  });

  it('resume step wins over the collaborator start step', () => {
    expect(
      getInitialStep({
        initialStepId: '',
        steps,
        sessionCurrentStep: 'review',
        collaboratorStartStep: 'details'
      })
    ).toBe('review');
  });

  it('ignores a collaborator start step that no longer exists', () => {
    expect(
      getInitialStep({
        initialStepId: '',
        steps,
        collaboratorStartStep: 'deleted'
      })
    ).toBe('intro');
  });
});
