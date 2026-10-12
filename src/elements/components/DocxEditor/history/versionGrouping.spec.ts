import { groupVersions } from './versionGrouping';
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

// A fixed "now" in a later year so the 2026 fixtures read as past months.
const NOW = new Date('2027-01-15T12:00:00');

describe('groupVersions', () => {
  beforeEach(() => {
    seq = 0;
  });

  it('buckets versions under month headers', () => {
    const sections = groupVersions(
      [v('2026-09-02T10:00:00'), v('2026-08-15T10:00:00')],
      NOW
    );
    expect(sections.map((s) => s.label)).toEqual([
      'September 2026',
      'August 2026'
    ]);
  });

  it('puts versions ended today under a Today header', () => {
    const now = new Date('2027-01-15T12:00:00');
    const sections = groupVersions(
      [
        v('2027-01-15T11:59:30'), // today
        v('2026-12-20T10:00:00') // last month
      ],
      now
    );
    expect(sections.map((s) => s.label)).toEqual(['Today', 'December 2026']);
  });

  it('uses a bare month name in the current year', () => {
    const now = new Date('2027-04-30T12:00:00');
    const sections = groupVersions([v('2027-04-02T10:00:00')], now);
    expect(sections[0].label).toBe('April');
  });

  // Newest-first sessions `gaps` minutes apart; the newest one is Current.
  const burst = (base: string, gaps: number[]) => {
    const rows = [v(base, { seq: 100 })];
    let t = 0;
    for (const gap of gaps) {
      t += gap;
      rows.push(v(at(base, t)));
    }
    return rows;
  };

  it('chains versions each within 15 minutes of the next-newer one', () => {
    const base = '2026-09-02T12:00:00';
    // 0, -10, -20, -30: each hop is 10 min, though the ends span 30 min.
    const rows = burst(base, [10, 10, 10]);
    const [section] = groupVersions(rows, NOW);
    expect(section.clusters).toHaveLength(1);
    expect(section.clusters[0].primary).toBe(rows[0]);
    expect(section.clusters[0].earlier).toEqual(rows.slice(1));
  });

  it('folds at exactly 15 minutes and splits just past it', () => {
    const base = '2026-09-02T12:00:00';
    const rows = [
      v(base, { seq: 100 }),
      v(at(base, 15)), // exactly 15:00 after the previous: folds
      v(new Date(new Date(at(base, 30)).getTime() - 1000).toISOString())
    ];
    const [section] = groupVersions(rows, NOW);
    expect(section.clusters.map((c) => c.primary)).toEqual([rows[0], rows[2]]);
    expect(section.clusters[0].earlier).toEqual([rows[1]]);
  });

  it('measures the gap from the newer session start, not its end', () => {
    const base = '2026-09-02T12:00:00';
    // Newer session ran 20 min but started 5 min after the older one ended.
    const rows = [
      v(base, { seq: 100, started_at: at(base, 20) }),
      v(at(base, 25))
    ];
    const [section] = groupVersions(rows, NOW);
    expect(section.clusters[0].earlier).toEqual([rows[1]]);
  });

  it('never folds across a section boundary', () => {
    const now = new Date(2027, 0, 15, 12, 0);
    const newest = new Date(2027, 0, 15, 0, 5).toISOString();
    const rows = [
      v(newest, { seq: 100 }),
      v(new Date(2027, 0, 14, 23, 55).toISOString()) // 10 min, but yesterday
    ];
    const sections = groupVersions(rows, now);
    expect(sections.map((s) => s.label)).toEqual(['Today', 'January']);
    expect(sections[0].clusters[0].earlier).toEqual([]);
  });

  it('never folds across midnight within a month section', () => {
    const rows = [
      v(new Date(2026, 8, 3, 0, 5).toISOString(), { seq: 100 }),
      v(new Date(2026, 8, 2, 23, 55).toISOString())
    ];
    const [section] = groupVersions(rows, NOW);
    expect(section.clusters).toHaveLength(2);
  });

  it('keeps Current, named, restored and baseline versions on their own row', () => {
    const base = '2026-09-02T12:00:00';
    const rows = [
      v(base, { seq: 100 }), // Current (highest seq)
      v(at(base, 2), { name: 'Signed off' }),
      v(at(base, 4)),
      v(at(base, 6), { restored_from_at: '2026-08-01T10:00:00' }),
      v(at(base, 8)),
      v(at(base, 10), { is_baseline: true })
    ];
    const [section] = groupVersions(rows, NOW);
    // Each pinned version heads a row; plain ones fold under the one above.
    expect(section.clusters.map((c) => c.primary)).toEqual([
      rows[0],
      rows[1],
      rows[3],
      rows[5]
    ]);
    expect(section.clusters.map((c) => c.earlier)).toEqual([
      [],
      [rows[2]],
      [rows[4]],
      []
    ]);
  });

  it('merges authors across a cluster in newest-first order', () => {
    const base = '2026-09-02T12:00:00';
    const [section] = groupVersions(
      [
        v(base, { seq: 100 }),
        v(at(base, 5), { authors: [{ kind: 'assistant', label: 'Robin' }] }),
        v(at(base, 9))
      ],
      NOW
    );
    expect(section.clusters[0].authors).toEqual([
      { kind: 'user', label: 'You' },
      { kind: 'assistant', label: 'Robin' }
    ]);
  });

  it('keeps different people apart when their sessions fold', () => {
    const base = '2026-09-02T12:00:00';
    const [section] = groupVersions(
      [
        v(base, { seq: 100, actor_name: 'Bob', actor_label: 'bob@x.io' }),
        v(at(base, 10), { actor_name: 'Alice', actor_label: 'alice@x.io' })
      ],
      NOW
    );
    expect(section.clusters).toHaveLength(1);
    expect(section.clusters[0].authors).toEqual([
      { kind: 'user', label: 'Bob', key: 'bob@x.io' },
      { kind: 'user', label: 'Alice', key: 'alice@x.io' }
    ]);
  });

  it('keeps versions newest-first within a month', () => {
    const base = '2026-09-02T12:00:00';
    const sections = groupVersions([v(base), v(at(base, 20))], NOW);
    expect(sections[0].clusters.map((c) => c.primary.ended_at)).toEqual([
      base,
      at(base, 20)
    ]);
  });

  it('lists each version with its own author(s)', () => {
    const base = '2026-09-02T12:00:00';
    const sections = groupVersions(
      [
        v(base, { authors: [{ kind: 'user', label: 'You' }] }),
        v(at(base, 20), { authors: [{ kind: 'assistant', label: 'Robin' }] })
      ],
      NOW
    );
    expect(sections[0].clusters[0].authors).toEqual([
      { kind: 'user', label: 'You' }
    ]);
    expect(sections[0].clusters[1].authors).toEqual([
      { kind: 'assistant', label: 'Robin' }
    ]);
  });
});
