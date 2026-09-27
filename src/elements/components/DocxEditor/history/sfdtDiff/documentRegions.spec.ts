import {
  applyHunks,
  contentHash,
  countEditGroups,
  diffSession,
  hash32,
  normalizeForDiff
} from './index';

const paragraph = (text: string) => ({ inlines: [{ text }] });

it('attributes header and footer edits without moving them into the body', () => {
  const before = {
    sections: [
      {
        blocks: [paragraph('Body')],
        headersFooters: {
          header: { blocks: [paragraph('Old header')] },
          footer: { blocks: [paragraph('Old footer')] }
        }
      }
    ]
  };
  const after = JSON.parse(JSON.stringify(before));
  after.sections[0].headersFooters.header.blocks = [paragraph('New header')];
  after.sections[0].headersFooters.footer.blocks = [paragraph('New footer')];
  const changes = diffSession(
    before,
    [{ sfdt: after, author: 'you' }],
    'regions'
  );
  expect(changes.hunks.length).toBeGreaterThan(0);
  expect(
    changes.hunks.every((hunk) => hunk.at.block[1] === 'headersFooters')
  ).toBe(true);
  const display = applyHunks(after, changes);
  expect(display.sections[0].blocks).toEqual(after.sections[0].blocks);
  expect(countEditGroups(display)).toBeGreaterThan(0);
  const accepted = normalizeForDiff(display);
  for (const name of ['header', 'footer']) {
    expect(
      accepted.sections[0].headersFooters[name].blocks[0].inlines
        .map((run: any) => run.text ?? '')
        .join('')
    ).toBe(`New ${name}`);
  }
});

it('checks the budget inside a single large slice and discards partial hunks', () => {
  const before = {
    sections: [
      {
        blocks: Array.from({ length: 100 }, () =>
          paragraph('Repeated contract clause before')
        )
      }
    ]
  };
  const after = {
    sections: [
      {
        blocks: Array.from({ length: 100 }, () =>
          paragraph('Repeated contract clause after')
        )
      }
    ]
  };
  let checks = 0;
  const changes = diffSession(
    before,
    [{ sfdt: after, author: 'you' }],
    'bounded',
    { timeBudgetMs: 10, now: () => (checks++ < 5 ? 0 : 100) }
  );
  expect(changes.degraded).toContain('time-budget');
  expect(changes.hunks).toEqual([]);
});

it('keeps a section-end deletion in the section where it happened', () => {
  const before = {
    sections: [
      { blocks: [paragraph('First section'), paragraph('Deleted ending')] },
      { blocks: [paragraph('Second section')] }
    ]
  };
  const after = {
    sections: [
      { blocks: [paragraph('First section')] },
      { blocks: [paragraph('Second section')] }
    ]
  };
  const changes = diffSession(
    before,
    [{ sfdt: after, author: 'you' }],
    'section-end'
  );
  const deletion = changes.hunks.find((hunk) => hunk.type === 'del_block');
  expect(deletion?.at.block).toEqual([0, 'blocks', 1]);
  const display = applyHunks(after, changes);
  expect(display.sections[1].blocks).toEqual(after.sections[1].blocks);
});

it('keeps the legacy UTF-16 fingerprint without allocating a reversed character array', () => {
  const document = { text: 'hello 🦊 é '.repeat(10_000) };
  const text = JSON.stringify(document);
  const expected = hash32(text) + hash32(text.split('').reverse().join(''));
  const split = jest.spyOn(String.prototype, 'split');
  try {
    expect(contentHash(document)).toBe(expected);
    expect(split).not.toHaveBeenCalled();
  } finally {
    split.mockRestore();
  }
});
