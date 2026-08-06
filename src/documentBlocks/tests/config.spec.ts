import { docxBlocksConfig } from '../config';

describe('docxBlocksConfig', () => {
  it('window key wins over localStorage', () => {
    const windowLike = {
      featheryDocxBlocks: { enabled: true, panel: false },
      localStorage: {
        getItem: () => JSON.stringify({ enabled: false, panel: true })
      }
    };
    expect(docxBlocksConfig(windowLike)).toEqual({
      enabled: true,
      panel: false
    });
  });

  it('falls back to localStorage JSON', () => {
    const windowLike = {
      localStorage: {
        getItem: (key: string) =>
          key === 'featheryDocxBlocks'
            ? JSON.stringify({ enabled: true, debug: true })
            : null
      }
    };
    expect(docxBlocksConfig(windowLike)).toEqual({
      enabled: true,
      debug: true
    });
  });

  it('returns empty config for malformed JSON, missing storage, or nothing set', () => {
    expect(
      docxBlocksConfig({ localStorage: { getItem: () => 'not json' } })
    ).toEqual({});
    expect(
      docxBlocksConfig({
        localStorage: {
          getItem: () => {
            throw new Error('denied');
          }
        }
      })
    ).toEqual({});
    expect(docxBlocksConfig({})).toEqual({});
    expect(docxBlocksConfig(undefined)).toEqual({});
  });
});
