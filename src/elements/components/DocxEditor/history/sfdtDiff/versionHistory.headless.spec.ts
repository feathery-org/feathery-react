import {
  HeadlessSession,
  readFixture,
  shoot,
  startHeadless
} from '../../../../../assistant/tools/docx/tests/headless/headlessSession';
import {
  applyHunks,
  countEditGroups,
  diffSession,
  normalizeForDiff
} from './index';

describe('version history in the pinned real Chrome engine', () => {
  let session: HeadlessSession;
  beforeAll(async () => {
    session = await startHeadless();
  });
  afterAll(async () => {
    await session?.close();
  });

  it.each(['Accept', 'Reject'])(
    '%s resolves an untagged Robin revision after a DOCX round trip',
    async (action) => {
      await session.call(
        'openHistoryReview',
        JSON.stringify({
          sections: [
            {
              blocks: [
                {
                  inlines: [
                    { text: 'Expense added', revisionIds: ['round-tripped'] }
                  ]
                }
              ]
            }
          ],
          revisions: [
            {
              revisionId: 'round-tripped',
              revisionType: 'Insertion',
              author: 'Robin\u2060\u2061',
              date: '2026-09-18T12:00:00Z'
            }
          ]
        })
      );
      try {
        const before = await session.call('historyReviewState');
        expect(before.revisions).toBe(1);
        await session.page.evaluate((action) => {
          const button = Array.from(
            globalThis.document.querySelectorAll('button')
          ).find((button) =>
            new RegExp(`^${action} \\d+$`).test(
              button.textContent?.trim() ?? ''
            )
          );
          if (!button) throw new Error(`${action} button not found`);
          button.click();
        }, action);
        const after = await session.call('historyReviewState');
        expect(after.revisions).toBe(0);
        expect(JSON.parse(after.sfdt).revisions ?? []).toHaveLength(0);
        expect(after.text).not.toMatch(/Accept \d+/);
        expect(after.sfdt.includes('Expense added')).toBe(action === 'Accept');
        expect(after.artifacts.some((changes: any) => changes.confirmed)).toBe(
          action === 'Accept'
        );
      } finally {
        await session.call('closeHistoryReview');
      }
    }
  );

  it('accepts a saved duplicate table and clears its review card', async () => {
    const cell = (text: string) => ({
      cellFormat: {},
      blocks: [{ inlines: [{ text }] }]
    });
    await session.call(
      'openHistoryReview',
      JSON.stringify({
        sections: [
          {
            blocks: [
              { inlines: [{ text: 'Expenses' }] },
              {
                tableFormat: { allowAutoFit: true },
                rows: [
                  { rowFormat: {}, cells: [cell('Design'), cell('$500')] },
                  { rowFormat: {}, cells: [cell('Development'), cell('$900')] }
                ]
              },
              { inlines: [{ text: 'End' }] }
            ]
          }
        ]
      })
    );
    try {
      const result = await session.call('suggestHistoryReview', [
        {
          op: 'duplicate_table',
          anchor: '0;1;0;0;0',
          rows: 'copy',
          group: 'duplicate-expenses'
        }
      ]);
      expect(result.results[0].ok).toBe(true);
      const before = await session.call('historyReviewState');
      expect(before.revisions).toBeGreaterThan(0);
      expect(before.artifacts).toHaveLength(1);
      await session.page.evaluate(() => {
        const button = Array.from(
          globalThis.document.querySelectorAll('button')
        ).find((button) =>
          /^Accept \d+$/.test(button.textContent?.trim() ?? '')
        );
        if (!button) throw new Error('Accept button not found');
        button.click();
      });
      const after = await session.call('historyReviewState');
      expect(after.revisions).toBe(0);
      expect(JSON.parse(after.sfdt).revisions ?? []).toHaveLength(0);
      expect(after.text).not.toContain('Duplicate expenses');
    } finally {
      await session.call('closeHistoryReview');
    }
  });

  it('accepts a saved Robin edit in the live editor and clears its review card', async () => {
    await session.call(
      'openHistoryReview',
      JSON.stringify({
        sections: [{ blocks: [{ inlines: [{ text: 'Premium: $5,200' }] }] }]
      })
    );
    try {
      await session.call('suggestHistoryReview', [
        {
          op: 'replace_text',
          anchor: '0;0',
          find: '$5,200',
          replace: '$5,500',
          group: 'update-premium'
        }
      ]);
      const before = await session.call('historyReviewState');
      expect(before.revisions).toBeGreaterThan(0);
      expect(before.artifacts).toHaveLength(1);
      await session.page.evaluate(() => {
        const button = Array.from(
          globalThis.document.querySelectorAll('button')
        ).find((button) =>
          /^Accept \d+$/.test(button.textContent?.trim() ?? '')
        );
        if (!button) throw new Error('Accept button not found');
        button.click();
      });
      const after = await session.call('historyReviewState');
      expect(after.revisions).toBe(0);
      expect(after.text).not.toContain('Update premium');
      expect(JSON.parse(after.sfdt).revisions ?? []).toHaveLength(0);
      expect(after.artifacts.some((changes: any) => changes.confirmed)).toBe(
        true
      );
    } finally {
      await session.call('closeHistoryReview');
    }
  });

  it('keeps the preview painted at the same scroll and zoom through repeated highlight toggles', async () => {
    const sfdt = {
      sections: [
        {
          blocks: Array.from({ length: 160 }, (_, index) => ({
            inlines: [
              {
                text: `Paragraph ${index}: The document remains readable while highlights are toggled. `
              },
              {
                text: 'Original blue text.',
                characterFormat: { fontColor: '#2F5496' },
                revisionIds: ['added']
              },
              { text: 'Deleted words.', revisionIds: ['deleted'] }
            ]
          }))
        }
      ],
      revisions: [
        {
          author: 'Robin',
          revisionType: 'Insertion',
          revisionId: 'added',
          date: '2026-09-18T12:00:00Z'
        },
        {
          author: 'Robin',
          revisionType: 'Deletion',
          revisionId: 'deleted',
          date: '2026-09-18T12:00:00Z'
        }
      ]
    };
    const before = await session.call(
      'openVersionPreview',
      JSON.stringify(sfdt)
    );
    expect(before.top).toBe(1400);
    try {
      for (const highlightsOn of [false, true, false, true]) {
        const result = await session.call('toggleVersionPreview', highlightsOn);
        for (const frame of result.frames) {
          expect(frame.top).toBe(before.top);
          expect(frame.left).toBe(before.left);
          expect(frame.zoom).toBe(before.zoom);
          expect(frame.loading).toBe(false);
          expect(frame.opacity).toBe('1');
          expect(frame.ink).toBeGreaterThan(100);
        }
        const displayed = JSON.parse(result.sfdt);
        expect(Boolean(displayed.revisions?.length)).toBe(highlightsOn);
        if (!highlightsOn) {
          expect(result.sfdt).not.toContain('Deleted words.');
          expect(result.sfdt).toContain('#2F5496');
        }
      }
    } finally {
      await session.call('closeVersionPreview');
    }
  });

  it('renders header/footer and table-cell highlights and restores renderer state', async () => {
    const before = JSON.parse(readFixture('flagship-v4d.browser.sfdt.json'));
    const after = JSON.parse(JSON.stringify(before));
    let regionEdits = 0;
    const changeFirstText = (node: any): boolean => {
      if (!node || typeof node !== 'object') return false;
      if (typeof node.text === 'string' && node.text.trim()) {
        node.text += ' History audit';
        return true;
      }
      return Object.values(node).some(changeFirstText);
    };
    for (const region of Object.values(
      after.sections[0].headersFooters ?? {}
    )) {
      if (changeFirstText(region)) regionEdits++;
    }
    const table = after.sections
      .flatMap((section: any) => section.blocks)
      .find((block: any) => block.rows?.length);
    expect(table).toBeTruthy();
    expect(changeFirstText(table.rows[0].cells[0])).toBe(true);
    expect(regionEdits).toBeGreaterThan(0);
    const began = Date.now();
    const changes = diffSession(
      before,
      [{ sfdt: after, author: 'you' }],
      'real-regions',
      { timeBudgetMs: 4000 }
    );
    const elapsed = Date.now() - began;
    expect(changes.degraded).toBeUndefined();
    const display = applyHunks(after, changes);
    await session.call('open', JSON.stringify(display));
    expect(await session.call('verifyHistoryRenderer')).toBe(true);
    const reopened = JSON.parse(await session.call<string>('serialize'));
    const textOf = (node: any): string => {
      if (!node || typeof node !== 'object') return '';
      if (typeof node.text === 'string') return node.text;
      return Object.values(node).map(textOf).join('');
    };
    expect(
      textOf(normalizeForDiff(reopened).sections[0].headersFooters.header)
    ).toBe(textOf(after.sections[0].headersFooters.header));
    expect(countEditGroups(reopened)).toBeGreaterThanOrEqual(regionEdits + 1);
    expect(
      reopened.revisions.some((revision: any) => revision.author === 'you')
    ).toBe(true);
    console.info(
      JSON.stringify({
        fixture: 'flagship-v4d',
        bytes: JSON.stringify(before).length,
        diffMs: elapsed,
        hunks: changes.hunks.length
      })
    );
    await shoot(session, 'version-history-review-regions');
  });

  it('observes contentChange after the actual text edit', async () => {
    await session.call('open', readFixture('flagship-v4d.browser.sfdt.json'));
    const snapshots = await session.call<string[]>(
      'observeHistoryEdit',
      ' HISTORY_POST_EDIT_PROBE'
    );
    expect(snapshots.length).toBeGreaterThan(0);
    expect(
      snapshots.every((snapshot) =>
        snapshot.includes('HISTORY_POST_EDIT_PROBE')
      )
    ).toBe(true);
  });
});
