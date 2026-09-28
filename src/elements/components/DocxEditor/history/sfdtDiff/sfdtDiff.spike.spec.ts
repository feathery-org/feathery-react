// Spike: does the close-time SFDT diff produce hunks the real Syncfusion engine
// (34.1.31, jsdom) will render as revisions? Answers, against the engine:
//   1. synthesized revisions open without error and survive serialize();
//   2. ids resolve on inlines and paragraph marks; authors come back intact,
//      including the `fmt:` prefixed formatting pseudo-author;
//   3. chained two-author slices land on final-document positions;
//   4. rough timing on a 400-paragraph document.
import {
  destroyRealDocumentEditor,
  docWith,
  makeRealDocumentEditor,
  para,
  textRun
} from '../../bindings/tests/realEditorHarness';
import {
  applyHunks,
  contentHash,
  diffSession,
  FMT_AUTHOR_PREFIX,
  normalizeForDiff
} from './index';
import type { Hunk } from './types';

const run = (text: string, characterFormat?: Record<string, unknown>) =>
  characterFormat ? { text, characterFormat } : textRun(text);

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v));

function textOf(sfdt: any): string[] {
  return sfdt.sections[0].blocks.map((b: any) =>
    (b.inlines ?? []).map((i: any) => i.text ?? '').join('')
  );
}

const BASE = docWith(
  para(run('Project cost estimate')),
  para(run('Summary of the work agreed at kickoff.')),
  para(
    run(
      'The remaining balance is payable net 30. Late payments accrue interest.'
    )
  ),
  para(run('Amount due for Website relaunch: $12,170.64.')),
  para(run('Not included: hosting and third-party licences.'))
);

describe('sfdtDiff spike', () => {
  it('never emits intermediate-state hunks as if anchored to the final document after a timeout', () => {
    let clock = 0;
    const middle = docWith(para(run('Robin insertion')));
    const final = docWith(para(run('Human replacement')));
    const changes = diffSession(
      docWith(para(run('Original'))),
      [
        { sfdt: middle, author: 'robin' },
        { sfdt: final, author: 'you' }
      ],
      'timeout',
      { timeBudgetMs: 1, now: () => clock++ }
    );
    expect(changes.degraded).toContain('time-budget');
    expect(changes.hunks).toEqual([]);
  });
  it('finds a word replace, a deleted paragraph, an added paragraph and a bolded span', () => {
    const after = clone(BASE);
    after.sections[0].blocks[2].inlines = [
      run(
        'The remaining balance is payable net 45. Late payments accrue interest.'
      )
    ];
    after.sections[0].blocks.splice(3, 1); // remove "Amount due"
    after.sections[0].blocks.push(
      para(run('Payment terms reviewed by legal.'))
    );
    after.sections[0].blocks[0].inlines = [
      run('Project cost estimate', { bold: true })
    ];

    const changes = diffSession(BASE, [{ sfdt: after, author: 'user' }], 's1');
    const types = changes.hunks.map((h) => h.type).sort();
    expect(types).toEqual(['del', 'del_block', 'fmt', 'ins', 'ins_block']);

    const del = changes.hunks.find((h) => h.type === 'del') as any;
    const ins = changes.hunks.find((h) => h.type === 'ins') as any;
    expect(del.text).toBe('30');
    expect(ins.at.length).toBe(2);
    expect(del.id).toBe(ins.id); // replace halves share an id
    // Offsets are exact against the final text.
    const finalPara = textOf(after)[2];
    expect(finalPara.slice(ins.at.offset, ins.at.offset + ins.at.length)).toBe(
      '45'
    );

    const fmt = changes.hunks.find((h) => h.type === 'fmt') as any;
    expect(fmt.props).toEqual({ bold: [null, true] });
    expect(fmt.at.length).toBe('Project cost estimate'.length);

    const delBlock = changes.hunks.find((h) => h.type === 'del_block') as any;
    // The removed paragraph anchors before what is now block 3 in F.
    expect(delBlock.at.block).toEqual([0, 'blocks', 3]);
    expect(changes.changeCount).toBe(4);
    expect(changes.formatChangeCount).toBe(1);
  });

  it('chains two authors and rebases earlier hunks onto the final document', () => {
    // User edits first, then Robin adds a paragraph ABOVE the user's edit and
    // deletes another; the user's hunk must move with its paragraph.
    const s1 = clone(BASE);
    s1.sections[0].blocks[2].inlines = [
      run(
        'The remaining balance is payable net 45. Late payments accrue interest.'
      )
    ];
    const f = clone(s1);
    f.sections[0].blocks.splice(1, 0, para(run('Prepared by Feathery AI.')));
    f.sections[0].blocks.splice(4, 1); // removes "Amount due" (now at index 4)

    const changes = diffSession(
      BASE,
      [
        { sfdt: s1, author: 'user' },
        { sfdt: f, author: 'assistant' }
      ],
      's2'
    );
    const byType = (t: Hunk['type']) =>
      changes.hunks.filter((h) => h.type === t);
    expect(byType('ins_block')[0].author).toBe('assistant');
    expect(byType('del_block')[0].author).toBe('assistant');
    const userIns = byType('ins').find((h) => h.author === 'user') as any;
    // The user's paragraph is now block 3 in F (Robin inserted one above it).
    expect(userIns.at.block).toEqual([0, 'blocks', 3]);
    expect(textOf(f)[3].slice(userIns.at.offset, userIns.at.offset + 2)).toBe(
      '45'
    );
    expect(changes.authors.sort()).toEqual(['assistant', 'user']);
  });

  it('drops self-reverted edits and hashes identical content identically', () => {
    const s1 = clone(BASE);
    s1.sections[0].blocks[1].inlines = [
      run('Summary of the work agreed at kickoff. TEMP')
    ];
    const changes = diffSession(
      BASE,
      [
        { sfdt: s1, author: 'user' },
        { sfdt: clone(BASE), author: 'user' }
      ],
      's3'
    );
    expect(changes.hunks).toEqual([]);
    expect(changes.changeCount).toBe(0);
    expect(contentHash(normalizeForDiff(BASE))).toBe(
      contentHash(normalizeForDiff(clone(BASE)))
    );
  });

  it('normalises pending tracked changes and image payloads before diffing', () => {
    const withRevisions = clone(BASE);
    withRevisions.revisions = [
      {
        author: 'Robin',
        date: 'x',
        revisionType: 'Deletion',
        revisionId: 'r1'
      },
      {
        author: 'Robin',
        date: 'x',
        revisionType: 'Insertion',
        revisionId: 'r2'
      }
    ];
    withRevisions.sections[0].blocks[1].inlines = [
      run('Summary '),
      { text: 'DELETED ', revisionIds: ['r1'] },
      { text: 'INSERTED ', revisionIds: ['r2'] },
      {
        imageString: 'data:image/png;base64,' + 'A'.repeat(500),
        width: 10,
        height: 10
      }
    ];
    const norm = normalizeForDiff(withRevisions);
    const inlines = norm.sections[0].blocks[1].inlines;
    expect(inlines.map((i: any) => i.text ?? '[img]')).toEqual([
      'Summary ',
      'INSERTED ',
      '[img]'
    ]);
    expect(inlines[2].imageString.startsWith('sha:')).toBe(true);
    expect(norm.revisions).toBeUndefined();
  });

  it('opens the display document in the real editor with resolvable revisions', () => {
    const after = clone(BASE);
    after.sections[0].blocks[2].inlines = [
      run(
        'The remaining balance is payable net 45. Late payments accrue interest.'
      )
    ];
    after.sections[0].blocks.splice(3, 1);
    after.sections[0].blocks.push(
      para(run('Payment terms reviewed by legal.'))
    );
    after.sections[0].blocks[0].inlines = [
      run('Project cost estimate', { bold: true })
    ];

    const changes = diffSession(BASE, [{ sfdt: after, author: 'user' }], 's4');
    const display = applyHunks(after, changes);
    expect(display.optimizeSfdt).toBe(false);
    expect(display.revisions.length).toBe(changes.hunks.length);

    const editor = makeRealDocumentEditor(display);
    try {
      const live = (editor as any).revisions?.changes ?? [];
      expect(live.length).toBeGreaterThan(0);
      const authors = new Set(live.map((r: any) => r.author));
      expect(authors.has('user')).toBe(true);
      expect(authors.has(`${FMT_AUTHOR_PREFIX}user`)).toBe(true);
      const types = new Set(live.map((r: any) => r.revisionType));
      expect(types.has('Insertion')).toBe(true);
      expect(types.has('Deletion')).toBe(true);

      // Round trip: the engine keeps our ids on the runs it re-serialises.
      const back = JSON.parse(editor.serialize());
      const ids = new Set<string>();
      const walk = (node: any) => {
        if (Array.isArray(node)) return node.forEach(walk);
        if (!node || typeof node !== 'object') return;
        if (Array.isArray(node.revisionIds))
          node.revisionIds.forEach((id: string) => ids.add(id));
        Object.values(node).forEach(walk);
      };
      walk(back.sections);
      expect(ids.size).toBeGreaterThanOrEqual(changes.hunks.length - 1);
      // Deleted text is present as Deletion runs: the paragraph reads with both
      // halves of the replace, and the removed paragraph is back in the flow.
      const paraTexts: string[] = back.sections[0].blocks.map((b: any) =>
        (b.inlines ?? []).map((i: any) => i.text ?? '').join('')
      );
      expect(paraTexts.some((s) => s.includes('net 3045.'))).toBe(true);
      expect(
        paraTexts.some((s) => s.startsWith('Amount due for Website relaunch'))
      ).toBe(true);
      const deletionIds = new Set(
        back.revisions
          .filter((r: any) => r.revisionType === 'Deletion')
          .map((r: any) => r.revisionId)
      );
      const thirty = back.sections[0].blocks
        .flatMap((b: any) => b.inlines ?? [])
        .find((i: any) => i.text === '30');
      expect(thirty.revisionIds.some((id: string) => deletionIds.has(id))).toBe(
        true
      );
    } finally {
      destroyRealDocumentEditor(editor);
    }
  });

  it('diffs a 400-paragraph document with 20 scattered edits quickly', () => {
    const blocks = Array.from({ length: 400 }, (_, i) =>
      para(
        run(
          `Paragraph ${i} describes clause ${
            i % 17
          } of the agreement in detail.`
        )
      )
    );
    const big = docWith(...blocks);
    const after = clone(big);
    for (let k = 0; k < 20; k++) {
      const idx = k * 19 + 3;
      after.sections[0].blocks[idx].inlines = [
        run(
          `Paragraph ${idx} describes clause ${
            idx % 17
          } of the agreement in great detail.`
        )
      ];
    }
    after.sections[0].blocks.splice(200, 0, para(run('An inserted clause.')));
    const t0 = Date.now();
    const changes = diffSession(big, [{ sfdt: after, author: 'user' }], 's5');
    const ms = Date.now() - t0;
    // eslint-disable-next-line no-console
    console.log(
      `[spike] 400 paragraphs, 21 edits: ${ms} ms, ${changes.hunks.length} hunks`
    );
    expect(changes.hunks.filter((h) => h.type === 'ins').length).toBe(20);
    expect(changes.hunks.filter((h) => h.type === 'ins_block').length).toBe(1);
    expect(ms).toBeLessThan(2000);
  });
});
