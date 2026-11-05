import { featheryDoc } from '../../utils/browser';
import {
  getLabelRuns,
  isPlainRuns,
  runsFromNodes,
  trimLabelRuns
} from './fieldLabelRuns';

const bold = { font_weight: 700 };

describe('getLabelRuns', () => {
  it('returns runs that spell out the name', () => {
    const runs = [{ insert: 'First ' }, { insert: 'name', attributes: bold }];
    expect(
      getLabelRuns({ name: 'First name', metadata: { name_formatted: runs } })
    ).toBe(runs);
  });

  it('ignores runs left stale by a rename elsewhere', () => {
    expect(
      getLabelRuns({
        name: 'Last name',
        metadata: { name_formatted: [{ insert: 'First name' }] }
      })
    ).toBeNull();
  });

  it('ignores missing or malformed runs', () => {
    expect(getLabelRuns({ name: 'A', metadata: {} })).toBeNull();
    expect(getLabelRuns({ name: 'A', metadata: { name_formatted: [] } })).toBe(
      null
    );
    expect(
      getLabelRuns({ name: 'A', metadata: { name_formatted: [{ insert: 1 }] } })
    ).toBeNull();
    expect(getLabelRuns(undefined)).toBeNull();
  });
});

describe('trimLabelRuns', () => {
  it('trims across run boundaries and drops emptied runs', () => {
    expect(
      trimLabelRuns([
        { insert: '  ' },
        { insert: ' Name', attributes: bold },
        { insert: 'd ' },
        { insert: ' ' }
      ])
    ).toEqual([{ insert: 'Name', attributes: bold }, { insert: 'd' }]);
  });

  it('returns nothing for whitespace-only runs', () => {
    expect(trimLabelRuns([{ insert: '  ' }])).toEqual([]);
  });
});

describe('runsFromNodes', () => {
  const span = (index: number | null, text: string) => {
    const el = featheryDoc().createElement('span');
    if (index !== null) el.dataset.index = String(index);
    el.textContent = text;
    return el;
  };

  it('keeps each node on the attributes of the run it came from', () => {
    const old = [{ insert: 'a' }, { insert: 'b', attributes: bold }];
    expect(runsFromNodes([span(0, 'ax'), span(1, 'by')], old)).toEqual([
      { insert: 'ax' },
      { insert: 'by', attributes: bold }
    ]);
  });

  it('merges neighbours that share formatting and skips empty nodes', () => {
    const old = [
      { insert: 'a', attributes: bold },
      { insert: 'b' },
      { insert: 'c', attributes: bold }
    ];
    expect(
      runsFromNodes([span(0, 'a'), span(1, ''), span(2, 'c')], old)
    ).toEqual([{ insert: 'ac', attributes: bold }]);
  });

  it('treats bare text nodes as the first run', () => {
    const old = [{ insert: 'a', attributes: bold }];
    expect(runsFromNodes([featheryDoc().createTextNode('typed')], old)).toEqual(
      [{ insert: 'typed', attributes: bold }]
    );
  });
});

describe('isPlainRuns', () => {
  it('is true only when no run has attributes', () => {
    expect(
      isPlainRuns([{ insert: 'a' }, { insert: 'b', attributes: {} }])
    ).toBe(true);
    expect(isPlainRuns([{ insert: 'a', attributes: bold }])).toBe(false);
  });
});
