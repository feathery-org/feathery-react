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
const NOW = new Date('2027-01-15T12:00:00Z');

describe('groupVersions', () => {
  beforeEach(() => {
    seq = 0;
  });

  it('buckets versions under month headers', () => {
    const sections = groupVersions(
      [v('2026-09-02T10:00:00Z'), v('2026-08-15T10:00:00Z')],
      NOW
    );
    expect(sections.map((s) => s.label)).toEqual([
      'September 2026',
      'August 2026'
    ]);
  });

  it('puts versions ended today under a Today header', () => {
    const now = new Date('2027-01-15T12:00:00Z');
    const sections = groupVersions(
      [
        v('2027-01-15T11:59:30Z'), // today
        v('2026-12-20T10:00:00Z') // last month
      ],
      now
    );
    expect(sections.map((s) => s.label)).toEqual(['Today', 'December 2026']);
  });

  it('uses a bare month name in the current year', () => {
    const now = new Date('2027-04-30T12:00:00Z');
    const sections = groupVersions([v('2027-04-02T10:00:00Z')], now);
    expect(sections[0].label).toBe('April');
  });

  it('renders every version as its own flat row (no clustering)', () => {
    const base = '2026-09-02T12:00:00Z';
    const sections = groupVersions(
      [
        v(base),
        v(at(base, 10)), // 10 min earlier — would have clustered before
        v(at(base, 20))
      ],
      NOW
    );
    // Flat: one month section, three separate rows, none nested.
    expect(sections).toHaveLength(1);
    expect(sections[0].clusters).toHaveLength(3);
    expect(sections[0].clusters.every((c) => c.earlier.length === 0)).toBe(true);
  });

  it('keeps versions newest-first within a month', () => {
    const base = '2026-09-02T12:00:00Z';
    const sections = groupVersions([v(base), v(at(base, 5))], NOW);
    expect(sections[0].clusters.map((c) => c.primary.ended_at)).toEqual([
      base,
      at(base, 5)
    ]);
  });

  it('lists each version with its own author(s)', () => {
    const base = '2026-09-02T12:00:00Z';
    const sections = groupVersions([
      v(base, { authors: [{ kind: 'user', label: 'You' }] }),
      v(at(base, 5), { authors: [{ kind: 'assistant', label: 'Robin' }] })
    ], NOW);
    expect(sections[0].clusters[0].authors).toEqual([
      { kind: 'user', label: 'You' }
    ]);
    expect(sections[0].clusters[1].authors).toEqual([
      { kind: 'assistant', label: 'Robin' }
    ]);
  });
});
