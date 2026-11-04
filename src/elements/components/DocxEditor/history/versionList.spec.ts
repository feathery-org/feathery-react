import { loadVersionList } from './versionList';
import type { DocxHistoryHost } from './types';

it('shares a list request between prefetch and rail, and refreshes after save', async () => {
  const host = {
    listVersions: jest.fn().mockResolvedValue([])
  } as unknown as DocxHistoryHost;
  const background = loadVersionList(host, '0:0');
  const rail = loadVersionList(host, '0:0');
  expect(background).toBe(rail);
  await background;
  await loadVersionList(host, '0:0');
  expect(host.listVersions).toHaveBeenCalledTimes(1);
  await loadVersionList(host, 'saved:0');
  expect(host.listVersions).toHaveBeenCalledTimes(2);
});

it('retries failure without invalidating a newer generation', async () => {
  const list = jest
    .fn()
    .mockRejectedValueOnce(new Error('offline'))
    .mockResolvedValue([]);
  const host = { listVersions: list } as unknown as DocxHistoryHost;
  await expect(loadVersionList(host, '0')).rejects.toThrow('offline');
  await expect(loadVersionList(host, '0')).resolves.toEqual([]);
  expect(list).toHaveBeenCalledTimes(2);
});
