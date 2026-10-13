import { hideNoOpVersions } from './noOpVersions';
import { DocxVersion } from './types';

const v = (seq: number, over: Partial<DocxVersion> = {}): DocxVersion =>
  ({
    id: `v${seq}`,
    session_id: `s${seq}`,
    seq,
    is_baseline: false,
    is_current: false,
    name: '',
    closed_at: '2026-09-02T12:00:00',
    restored_from: null,
    restored_from_at: null,
    final_sha256: `hash${seq}`,
    ...over
  } as DocxVersion);

const ids = (versions: DocxVersion[]) => versions.map((version) => version.id);

describe('hideNoOpVersions', () => {
  it('hides a closed version identical to the one before it', () => {
    expect(
      ids(
        hideNoOpVersions([
          v(3, { is_current: true }),
          v(2, { final_sha256: 'same' }),
          v(1, { final_sha256: 'same' })
        ])
      )
    ).toEqual(['v3', 'v1']);
  });

  it('keeps versions that differ from the one before them', () => {
    expect(ids(hideNoOpVersions([v(2), v(1)]))).toEqual(['v2', 'v1']);
  });

  it('never hides the current, open, named, restored or baseline version', () => {
    const same = { final_sha256: 'same' };
    const keep = [
      { is_current: true },
      { closed_at: null },
      { name: 'Final draft' },
      { restored_from: 'v0' },
      { restored_from_at: '2026-09-01T12:00:00' },
      { is_baseline: true }
    ];
    for (const over of keep) {
      expect(
        ids(hideNoOpVersions([v(2, { ...same, ...over }), v(1, same)]))
      ).toEqual(['v2', 'v1']);
    }
  });

  it('keeps an accepted-suggestion version that matches the one before it', () => {
    // Accepting a tracked change leaves the text unchanged, so the fingerprints
    // match, but the version records the changes it confirmed.
    expect(
      ids(
        hideNoOpVersions([
          v(3, { is_current: true }),
          v(2, { final_sha256: 'same', change_count: 2 }),
          v(1, { final_sha256: 'same', change_count: 2 })
        ])
      )
    ).toEqual(['v3', 'v2', 'v1']);
    expect(
      ids(
        hideNoOpVersions([
          v(3, { is_current: true }),
          v(2, { final_sha256: 'same', format_change_count: 1 }),
          v(1, { final_sha256: 'same' })
        ])
      )
    ).toEqual(['v3', 'v2', 'v1']);
  });

  it('keeps a version when either fingerprint is missing', () => {
    expect(
      ids(
        hideNoOpVersions([
          v(3, { final_sha256: '' }),
          v(2, { final_sha256: '' })
        ])
      )
    ).toEqual(['v3', 'v2']);
  });

  it('compares against the previous seq even when rows arrive unordered', () => {
    expect(
      ids(
        hideNoOpVersions([
          v(1, { final_sha256: 'same' }),
          v(3, { is_current: true }),
          v(2, { final_sha256: 'same' })
        ])
      )
    ).toEqual(['v1', 'v3']);
  });
});
