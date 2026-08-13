import { isStepperStepCompleted, isStepperStepReachable } from '../stepper';

describe('stepper helpers', () => {
  describe('isStepperStepCompleted', () => {
    describe('with resetCompletionOnBack off', () => {
      it('shows a submitted step as done regardless of position', () => {
        // A step submitted on an earlier pass stays done even when it sits
        // ahead of the current step (the pre-existing behavior).
        expect(isStepperStepCompleted(true, 4, 1, false)).toBe(true);
        expect(isStepperStepCompleted(true, 0, 1, false)).toBe(true);
      });

      it('never shows an unsubmitted step as done', () => {
        expect(isStepperStepCompleted(false, 0, 3, false)).toBe(false);
      });
    });

    describe('with resetCompletionOnBack on', () => {
      it('shows submitted steps at or behind the cursor as done', () => {
        // Looped back to step index 1: steps 0 and 1 stay done
        expect(isStepperStepCompleted(true, 0, 1, true)).toBe(true);
        expect(isStepperStepCompleted(true, 1, 1, true)).toBe(true);
      });

      it('hides submitted steps positioned ahead of the cursor', () => {
        // Looped back to step index 1: steps 2, 3, 4 no longer show done even
        // though they were submitted on the earlier pass
        expect(isStepperStepCompleted(true, 2, 1, true)).toBe(false);
        expect(isStepperStepCompleted(true, 4, 1, true)).toBe(false);
      });

      it('still never shows an unsubmitted step as done', () => {
        expect(isStepperStepCompleted(false, 0, 3, true)).toBe(false);
        expect(isStepperStepCompleted(false, 5, 3, true)).toBe(false);
      });
    });
  });

  describe('isStepperStepReachable', () => {
    it('is unreachable when it is the active step', () => {
      expect(isStepperStepReachable(true, true, true)).toBe(false);
    });

    it('is reachable for any non-active step when all-step navigation is on', () => {
      expect(isStepperStepReachable(false, true, false)).toBe(true);
    });

    it('is reachable for a completed non-active step without all-step navigation', () => {
      expect(isStepperStepReachable(false, false, true)).toBe(true);
    });

    it('is unreachable for an uncompleted non-active step without all-step navigation', () => {
      expect(isStepperStepReachable(false, false, false)).toBe(false);
    });
  });
});
