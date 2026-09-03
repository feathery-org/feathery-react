import { groupVersions, CLUSTER_GAP_MS } from './versionGrouping';
import { DocxVersion } from './types';

let seq = 0;
const v = (endedAt: string, over: Partial<DocxVersion> = {}): DocxVersion =>
  ({
    id: `v${seq++}`,
    session_id: `s${seq}`,
    seq: seq,
    is_baseline: false,
    is_current: false,
    name: '',
    started_at: endedAt,
    ended_at: endedAt,
    closed_at: endedAt,
    authors: [{ kind: 'user', label: 'You' }],
    actor_label: '',
    actor_name: '',
    restored_from: null,
    restored_from_at: null,
    editor_file: null,
    file: null,
    final_sfdt: null,
    changes: null,
    change_count: null,
    format_change_count: null,
    final_sha256: '',
    highlights_pruned_at: null,
    created_at: endedAt,
    ...over
  } as DocxVersion);

const at = (iso: string, minutesBefore = 0) =>
  new Date(new Date(iso).getTime() - minutesBefore * 60_000).toISOString();

describe('groupVersions', () => {
  beforeEach(() => {
    seq = 0;
  });

  it('buckets versions under month headers', () => {
    const sections = groupVersions([
      v('2026-09-02T10:00:00Z'),
      v('2026-08-15T10:00:00Z')
    ]);
    expect(sections.map((s) => s.label)).toEqual([
      'September 2026',
      'August 2026'
    ]);
  });

  it('collapses same-day saves within 15 minutes into one cluster', () => {
    const base = '2026-09-02T12:00:00Z';
    const sections = groupVersions([
      v(base),
      v(at(base, 10)), // 10 min earlier
      v(at(base, 20)) // 20 min before the first — but only 10 before the 2nd
    ]);
    // All three chain: each is within 15 min of the previous.
    expect(sections).toHaveLength(1);
    expect(sections[0].clusters).toHaveLength(1);
    expect(sections[0].clusters[0].earlier).toHaveLength(2);
  });

  it('starts a new cluster when the gap exceeds 15 minutes', () => {
    const base = '2026-09-02T12:00:00Z';
    const sections = groupVersions([v(base), v(at(base, 16))]);
    expect(sections[0].clusters).toHaveLength(2);
  });

  it('never merges across a day boundary', () => {
    // 10 minutes apart in clock terms, but straddling LOCAL midnight (grouping
    // is by the viewer's local day). Built in local time so the test is
    // timezone-independent.
    const justAfterMidnight = new Date(2026, 8, 2, 0, 5).toISOString();
    const justBeforeMidnight = new Date(2026, 8, 1, 23, 55).toISOString();
    const sections = groupVersions([
      v(justAfterMidnight),
      v(justBeforeMidnight)
    ]);
    expect(sections[0].clusters).toHaveLength(2);
  });

  it('merges the distinct authors of a cluster', () => {
    const base = '2026-09-02T12:00:00Z';
    const sections = groupVersions([
      v(base, { authors: [{ kind: 'user', label: 'You' }] }),
      v(at(base, 5), { authors: [{ kind: 'assistant', label: 'Robin' }] }),
      v(at(base, 8), { authors: [{ kind: 'user', label: 'You' }] })
    ]);
    expect(sections[0].clusters[0].authors).toEqual([
      { kind: 'user', label: 'You' },
      { kind: 'assistant', label: 'Robin' }
    ]);
  });

  it('keeps the newest as the cluster primary', () => {
    const base = '2026-09-02T12:00:00Z';
    const [primaryIso, earlierIso] = [base, at(base, 5)];
    const sections = groupVersions([v(primaryIso), v(earlierIso)]);
    expect(sections[0].clusters[0].primary.ended_at).toBe(primaryIso);
    expect(CLUSTER_GAP_MS).toBe(900_000);
  });
});
