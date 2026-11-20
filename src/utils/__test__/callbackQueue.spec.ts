import CallbackQueue from '../callbackQueue';

jest.mock('../../elements/components/Spinner', () => () => null);

const step = { buttons: [] };

describe('callback loading while a button action is pending', () => {
  it.each(['full_page', 'on_button'])(
    'keeps the %s spinner when a background callback finishes first',
    async (showOn) => {
      const pendingLoader = { generate: { showOn } };
      let loaders = pendingLoader;
      const setLoaders = jest.fn((update) => {
        loaders = typeof update === 'function' ? update(loaders) : update;
      });
      const queue = new CallbackQueue(step, setLoaders, () => true);

      queue.addCallback(Promise.resolve());
      await queue._clearQueueLoader();

      expect(loaders).toBe(pendingLoader);
    }
  );

  it('clears callback loaders when no button action is running', async () => {
    const setLoaders = jest.fn();
    const queue = new CallbackQueue(step, setLoaders, () => false);

    queue.addCallback(Promise.resolve());
    await queue._clearQueueLoader();

    expect(setLoaders).toHaveBeenLastCalledWith({});
  });
});
