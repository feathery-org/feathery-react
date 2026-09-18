jest.doMock('libphonenumber-js', () => {
  throw new Error('chunk load failed');
});

it('resolves to no parser when the phone library chunk fails to load', async () => {
  let validation: any;
  jest.isolateModules(() => {
    validation = require('../validation');
  });

  validation.loadPhoneValidator();

  // Form loading awaits this promise; it must settle instead of rejecting so a
  // blocked chunk download degrades phone parsing rather than the whole form.
  await expect(validation.phoneLibPromise).resolves.toBeNull();
  expect(validation.phoneLib).toBeNull();
});
