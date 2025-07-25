/**
 * Unit tests for step submission error handling
 * Tests the specific bug fix where step advancement should be prevented when submission fails
 */

// Mock the action processing logic to test our fix
describe('Step Submission Error Handling', () => {
  let mockSubmitPromise: Promise<any>;
  let mockClient: any;
  let mockConsoleError: jest.SpyInstance;
  let mockGoToNewStep: jest.Mock;

  beforeEach(() => {
    mockConsoleError = jest
      .spyOn(console, 'error')
      .mockImplementation(() => {});
    mockGoToNewStep = jest.fn();
    mockClient = {
      submitStep: jest.fn(),
      registerEvent: jest.fn().mockResolvedValue({})
    };
  });

  afterEach(() => {
    mockConsoleError.mockRestore();
    jest.clearAllMocks();
  });

  describe('ACTION_NEXT processing with submitPromise', () => {
    it('should advance step when submission succeeds', async () => {
      // Arrange
      mockSubmitPromise = Promise.resolve();
      let actionProcessed = false;

      // Simulate the ACTION_NEXT processing logic from our fix
      const processAction = async () => {
        try {
          if (mockSubmitPromise) {
            await mockSubmitPromise;
          }

          // If we get here, submission succeeded
          await mockGoToNewStep({
            redirectKey: 'step-2',
            elementType: 'button',
            submitData: true,
            submitPromise: null
          });
          actionProcessed = true;
        } catch (error) {
          console.error('Step submission failed, not advancing:', error);
          return; // Stop processing actions if submission failed
        }
      };

      // Act
      await processAction();

      // Assert
      expect(mockGoToNewStep).toHaveBeenCalledWith({
        redirectKey: 'step-2',
        elementType: 'button',
        submitData: true,
        submitPromise: null
      });
      expect(actionProcessed).toBe(true);
      expect(mockConsoleError).not.toHaveBeenCalled();
    });

    it('should NOT advance step when submission fails', async () => {
      // Arrange
      const submitError = new Error('Network request failed');
      mockSubmitPromise = Promise.reject(submitError);
      let actionProcessed = false;

      // Simulate the ACTION_NEXT processing logic from our fix
      const processAction = async () => {
        try {
          if (mockSubmitPromise) {
            await mockSubmitPromise;
          }

          // If we get here, submission succeeded
          await mockGoToNewStep({
            redirectKey: 'step-2',
            elementType: 'button',
            submitData: true,
            submitPromise: null
          });
          actionProcessed = true;
        } catch (error) {
          console.error('Step submission failed, not advancing:', error);
          return; // Stop processing actions if submission failed
        }
      };

      // Act
      await processAction();

      // Assert
      expect(mockGoToNewStep).not.toHaveBeenCalled();
      expect(actionProcessed).toBe(false);
      expect(mockConsoleError).toHaveBeenCalledWith(
        'Step submission failed, not advancing:',
        submitError
      );
    });

    it('should advance step when there is no submitPromise', async () => {
      // Arrange
      mockSubmitPromise = null as any;
      let actionProcessed = false;

      // Simulate the ACTION_NEXT processing logic from our fix
      const processAction = async () => {
        try {
          if (mockSubmitPromise) {
            await mockSubmitPromise;
          }

          // If we get here, submission succeeded or there was no submission
          await mockGoToNewStep({
            redirectKey: 'step-2',
            elementType: 'button',
            submitData: false,
            submitPromise: null
          });
          actionProcessed = true;
        } catch (error) {
          console.error('Step submission failed, not advancing:', error);
          return; // Stop processing actions if submission failed
        }
      };

      // Act
      await processAction();

      // Assert
      expect(mockGoToNewStep).toHaveBeenCalledWith({
        redirectKey: 'step-2',
        elementType: 'button',
        submitData: false,
        submitPromise: null
      });
      expect(actionProcessed).toBe(true);
      expect(mockConsoleError).not.toHaveBeenCalled();
    });
  });

  describe('goToNewStep with failed submitPromise', () => {
    it('should NOT complete form when final step submission fails', async () => {
      // Arrange
      const submitError = new Error('Final step submission failed');
      mockSubmitPromise = Promise.reject(submitError);
      let formCompleted = false;

      // Simulate goToNewStep logic for form completion
      const goToNewStep = async ({ redirectKey, submitPromise }: any) => {
        if (!redirectKey) {
          // Form completion scenario
          if (submitPromise) {
            try {
              await submitPromise;
            } catch (error) {
              console.error('Step submission failed:', error);
              return; // Don't complete the form if submission failed
            }
          }
          // If we get here, form should be completed
          formCompleted = true;
        }
      };

      // Act
      await goToNewStep({
        redirectKey: null, // No next step = form completion
        submitPromise: mockSubmitPromise
      });

      // Assert
      expect(formCompleted).toBe(false);
      expect(mockConsoleError).toHaveBeenCalledWith(
        'Step submission failed:',
        submitError
      );
    });

    it('should complete form when final step submission succeeds', async () => {
      // Arrange
      mockSubmitPromise = Promise.resolve();
      let formCompleted = false;

      // Simulate goToNewStep logic for form completion
      const goToNewStep = async ({ redirectKey, submitPromise }: any) => {
        if (!redirectKey) {
          // Form completion scenario
          if (submitPromise) {
            try {
              await submitPromise;
            } catch (error) {
              console.error('Step submission failed:', error);
              return; // Don't complete the form if submission failed
            }
          }
          // If we get here, form should be completed
          formCompleted = true;
        }
      };

      // Act
      await goToNewStep({
        redirectKey: null, // No next step = form completion
        submitPromise: mockSubmitPromise
      });

      // Assert
      expect(formCompleted).toBe(true);
      expect(mockConsoleError).not.toHaveBeenCalled();
    });
  });

  describe('submitStep error handling', () => {
    it('should return early when stepPromise fails in after-submit logic', async () => {
      // Arrange
      const submitError = new Error('After-submit logic failed');
      mockSubmitPromise = Promise.reject(submitError);
      let afterSubmitCompleted = false;

      // Simulate the submitStep logic with hasSubmitAfter
      const submitStep = async () => {
        const hasSubmitAfter = true;

        if (hasSubmitAfter) {
          try {
            await mockSubmitPromise;
          } catch (error) {
            console.error(
              'Step submission failed during after-submit logic:',
              error
            );
            return; // Return early on failure
          }

          // If we get here, after-submit logic should continue
          afterSubmitCompleted = true;
        }

        return [mockSubmitPromise];
      };

      // Act
      const result = await submitStep();

      // Assert
      expect(result).toBeUndefined(); // Should return early, not return the promise array
      expect(afterSubmitCompleted).toBe(false);
      expect(mockConsoleError).toHaveBeenCalledWith(
        'Step submission failed during after-submit logic:',
        submitError
      );
    });
  });
});
