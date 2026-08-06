// Where the two accept-group guarantees meet.
//
// Two independent changes reworked `groupRevisionsAtomic`:
//
//   - the accept group is PERSISTENT: its id rides in SyncFusion's
//     `revisionSettings.customData`, so a grouped review card survives a
//     save/reload where the in-memory accept/reject wrappers die;
//   - a rejected card also puts back TABLE APPEARANCE: SyncFusion authors no
//     revision for a fill or a border, so the executor hands the group its
//     restore snapshots and rejecting replays them FIRST, while the row indices
//     they name are still valid.
//
// Each side alone is fine. Together they create a question neither could ask:
// the persistent tag PARTITIONS a change set into several groups, so "the
// appearance this change set overwrote" is no longer one list bound to one card.
// It has to be bucketed per group, or rejecting one card silently repaints a
// table a different card was responsible for.
//
// Everything here drives a REAL DocumentEditor. Whether `customData` round-trips
// through SFDT, and whether an in-memory closure does, are facts about the SDK -
// a mock would happily confirm either answer.
import 'jest-canvas-mock';
import {
  DocumentEditor,
  Editor,
  EditorHistory,
  ImageResizer,
  Search,
  Selection,
  SfdtExport
} from '@syncfusion/ej2-documenteditor';

import {
  applyDocumentEdits,
  getDocumentInventory,
  readSelection,
  rejectProjectionStream,
  LiveEditor,
  TableFacts
} from '../syncfusionDocumentOps';
import {
  listRevisionGroups,
  parseRevisionGroupTag,
  rebindRevisionGroups,
  resolveLiveRevisionGroupsAsOneUndo,
  resolveRevisionsAsOneUndo
} from '../../../../utils/documentEditorPrimitives';

DocumentEditor.Inject(
  Editor,
  Selection,
  SfdtExport,
  EditorHistory,
  ImageResizer,
  Search
);

if (!window.crypto?.getRandomValues) {
  Object.defineProperty(window, 'crypto', {
    value: {
      getRandomValues: (array: Uint8Array) =>
        require('crypto').randomFillSync(array)
    }
  });
}
if (!(window.SVGElement.prototype as any).getBBox) {
  (window.SVGElement.prototype as any).getBBox = () =>
    ({ x: 0, y: 0, width: 0, height: 0 } as DOMRect);
}

function makeEditor(sfdt: any): DocumentEditor {
  const host = document.createElement('div');
  host.style.width = '900px';
  host.style.height = '700px';
  document.body.appendChild(host);
  const editor = new DocumentEditor({
    isReadOnly: false,
    enableEditor: true,
    enableSelection: true,
    enableImageResizer: true,
    enableSearch: true,
    enableSfdtExport: true,
    enableEditorHistory: true
  });
  editor.appendTo(host);
  editor.open(JSON.stringify(sfdt));
  return editor;
}

function destroyEditor(editor: DocumentEditor): void {
  const element = editor.element;
  editor.destroy();
  element?.remove();
}

const revisions = (ed: DocumentEditor): any[] => {
  const collection = (ed as any).revisions;
  const out: any[] = [];
  for (let index = 0; index < (collection?.length ?? 0); index++) {
    const revision = collection.changes?.[index] ?? collection[index];
    if (revision) out.push(revision);
  }
  return out;
};

// --- Fixture: the captain's document ----------------------------------------

const HEADER_FILL = '#1F3864';
const BAND_FILL = '#D9E2F3';

const cell = (text: string, background?: string) => ({
  cellFormat: {
    preferredWidth: 100,
    ...(background ? { shading: { backgroundColor: background } } : {})
  },
  blocks: [{ inlines: [{ text }] }]
});

const row = (texts: string[], background?: string, isHeader?: boolean) => ({
  rowFormat: isHeader ? { isHeader: true } : {},
  cells: texts.map((text) => cell(text, background))
});

/** 0;0 heading, 0;1 banded schedule, 0;2 plain schedule, 0;3 trailing text. */
const twoTables = () => ({
  sections: [
    {
      blocks: [
        { inlines: [{ text: 'Location Schedule' }] },
        {
          tableFormat: { preferredWidth: 300 },
          rows: [
            row(['Loc #', 'Address'], HEADER_FILL, true),
            row(['1', 'A St']),
            row(['2', 'B St'], BAND_FILL),
            row(['3', 'C St']),
            row(['4', 'D St'], BAND_FILL)
          ]
        },
        {
          tableFormat: { preferredWidth: 300 },
          rows: [
            row(['Loc #', 'Address']),
            row(['5', 'E St']),
            row(['6', 'F St']),
            row(['7', 'G St']),
            row(['8', 'H St'])
          ]
        },
        { inlines: [{ text: 'End' }] }
      ]
    }
  ]
});

const facts = (ed: DocumentEditor, tableAnchor: string): TableFacts => {
  const read = getDocumentInventory(ed as unknown as LiveEditor, {
    scope: 'table_facts',
    tableAnchor
  });
  return (read as { table: TableFacts }).table;
};

const appearanceSnapshot = (ed: DocumentEditor, tableAnchor: string) =>
  facts(ed, tableAnchor).rows.map((entry) => ({
    isHeader: entry.isHeader ?? false,
    appearance: entry.appearance,
    cells: entry.cells.map((cell) => cell.appearance)
  }));

/** Every row's shared fill, as the model sees it. `null` is "no fill". */
const fills = (ed: DocumentEditor, tableAnchor: string) =>
  facts(ed, tableAnchor).rows.map((entry) => entry.appearance?.shading ?? null);

const rejectStream = (ed: DocumentEditor) =>
  rejectProjectionStream(JSON.parse(ed.serialize()));

const apply = (ed: DocumentEditor, edits: any[], changeSetId: string) =>
  applyDocumentEdits(ed as unknown as LiveEditor, { edits, changeSetId });

/** Reject the group with this id by clicking ONE of its member revisions. */
const rejectGroup = (ed: DocumentEditor, group: string) => {
  const view = listRevisionGroups(ed as unknown as LiveEditor).find(
    (entry) => entry.group === group
  );
  expect(view).toBeDefined();
  (view as any).items[0].revision.reject();
};

/**
 * What the SFDT STATES about a table's layout, normalized. A reject has to leave
 * these as the document had them: SyncFusion's own widget always answers with a
 * concrete `allowAutoFit` and materialized column widths, so replaying a widget
 * reading as the restore would write `allowAutoFit: false` and a point-width
 * grid INTO a table that stated neither.
 */
const widthType = (raw: any): string =>
  raw === undefined
    ? 'Auto'
    : typeof raw === 'number'
    ? ['Auto', 'Percent', 'Point'][raw] ?? String(raw)
    : String(raw);

const statedTableLayout = (ed: DocumentEditor, tableAnchor: string) => {
  const parsed = JSON.parse(ed.serialize());
  const sections = parsed.sections ?? parsed.sec;
  const [section, block] = tableAnchor.split(';').map(Number);
  const table = (sections[section].blocks ?? sections[section].b)[block];
  const format = table.tableFormat ?? table.tblpr ?? {};
  const rows = table.rows ?? table.r ?? [];
  const cells = rows[0]?.cells ?? rows[0]?.c ?? [];
  const rawAutoFit = format.allowAutoFit ?? format.auft;
  return {
    allowAutoFit: rawAutoFit === undefined ? true : Boolean(rawAutoFit),
    preferredWidthType: widthType(
      format.preferredWidthType ?? format.pwt ?? undefined
    ),
    cellWidthTypes: cells.map((entry: any) => {
      const cellFormat = entry.cellFormat ?? entry.tcpr ?? {};
      return widthType(cellFormat.preferredWidthType ?? cellFormat.pwt);
    })
  };
};

/** A source with a stated fixed layout, and a target that states none. */
const statedLayoutFixture = () => ({
  sections: [
    {
      blocks: [
        { inlines: [{ text: 'Location Schedule' }] },
        {
          tableFormat: {
            preferredWidth: 400,
            preferredWidthType: 'Point',
            allowAutoFit: false
          },
          rows: [
            row(['Loc #', 'Address'], HEADER_FILL, true),
            row(['1', 'A St']),
            row(['2', 'B St'], BAND_FILL)
          ]
        },
        {
          tableFormat: {},
          rows: [
            { rowFormat: {}, cells: ['Loc #', 'Address'].map(plainCell) },
            { rowFormat: {}, cells: ['5', 'E St'].map(plainCell) },
            { rowFormat: {}, cells: ['6', 'F St'].map(plainCell) }
          ]
        },
        { inlines: [{ text: 'End' }] }
      ]
    }
  ]
});

const plainCell = (text: string) => ({
  cellFormat: {},
  blocks: [{ inlines: [{ text }] }]
});

// ---------------------------------------------------------------------------

describe('one change set that edits content AND restripes a table', () => {
  it('rebuilds layout once after accepting a multi-revision table group', () => {
    const ed = makeEditor(twoTables());
    try {
      const result = apply(
        ed,
        [
          { op: 'insert_row', anchor: '0;1;2;0;0' },
          {
            op: 'set_cell_text',
            anchor: '0;1;1;0;0',
            text: 'A1 rewritten'
          }
        ],
        'relayout-after-accept'
      );
      expect(result.results.every((entry) => entry.ok)).toBe(true);
      expect(revisions(ed).length).toBeGreaterThan(1);

      const layout = (ed as any).documentHelper.layout;
      const layoutSpy = jest.spyOn(layout, 'layoutWholeDocument');
      resolveLiveRevisionGroupsAsOneUndo(
        ed as unknown as LiveEditor,
        listRevisionGroups(ed as unknown as LiveEditor),
        true
      );

      expect(revisions(ed)).toHaveLength(0);
      expect(layoutSpy).toHaveBeenCalledTimes(1);
    } finally {
      destroyEditor(ed);
    }
  });

  it('keeps post-resolution relayout visually silent', () => {
    const ed = makeEditor(twoTables());
    try {
      const result = apply(
        ed,
        [
          { op: 'insert_row', anchor: '0;1;2;0;0' },
          {
            op: 'set_cell_text',
            anchor: '0;1;1;0;0',
            text: 'A1 rewritten'
          }
        ],
        'silent-relayout-after-accept'
      );
      expect(result.results.every((entry) => entry.ok)).toBe(true);
      expect(revisions(ed).length).toBeGreaterThan(1);

      const documentHelper = (ed as any).documentHelper;
      const viewer = documentHelper.viewerContainer as HTMLElement;
      let selectionBefore: ReturnType<typeof readSelection> | undefined;
      const history = (ed as any).editorHistoryModule;
      const originalUpdateHistory = history.updateComplexHistory.bind(history);
      jest.spyOn(history, 'updateComplexHistory').mockImplementation(() => {
        originalUpdateHistory();
        // Revision resolution is the explicit user action. Put the user's
        // still-active range back at the post-resolution boundary, then prove
        // the background relayout itself cannot disturb it or the viewport.
        ed.selection.select('0;3;0', '0;3;3');
        selectionBefore = readSelection(ed as unknown as LiveEditor);
        viewer.scrollTop = 275;
        viewer.scrollLeft = 19;
      });
      const layout = (ed as any).documentHelper.layout;
      const layoutSpy = jest
        .spyOn(layout, 'layoutWholeDocument')
        .mockImplementation(() => {
          // Pin the live regression even when jsdom's zero-sized page geometry
          // does not naturally reproduce the browser's top jump.
          viewer.scrollTop = 0;
          viewer.scrollLeft = 0;
          ed.selection.select('0;0;0', '0;0;0');
        });
      resolveLiveRevisionGroupsAsOneUndo(
        ed as unknown as LiveEditor,
        listRevisionGroups(ed as unknown as LiveEditor),
        true
      );

      expect(revisions(ed)).toHaveLength(0);
      expect(layoutSpy).toHaveBeenCalledTimes(1);
      expect(selectionBefore).toBeDefined();
      expect(readSelection(ed as unknown as LiveEditor)).toEqual(
        selectionBefore
      );
      expect(viewer.scrollTop).toBe(275);
      expect(viewer.scrollLeft).toBe(19);
      expect(documentHelper.skipScrollToPosition).toBe(false);
    } finally {
      destroyEditor(ed);
    }
  });

  it('is ONE grouped card, and rejecting it restores appearance and content', () => {
    const ed = makeEditor(twoTables());
    try {
      const originalFills = fills(ed, '0;1');
      const originalRowCount = facts(ed, '0;1').rowCount;
      const originalRejectStream = rejectStream(ed);

      const result = apply(
        ed,
        [
          { op: 'insert_row', anchor: '0;1;2;0;0' },
          // An EXISTING cell above the insert point: a tracked replace, so this
          // op is a Deletion revision plus an Insertion revision of its own and
          // the batch really does have several cards to bind into one.
          { op: 'set_cell_text', anchor: '0;1;1;0;0', text: 'A1 rewritten' },
          { op: 'restripe_table', anchor: '0;1;0;0;0' }
        ],
        'one-card'
      );

      expect(result.results.every((entry) => entry.ok)).toBe(true);
      // ONE accept unit for the whole batch: no op declared a `group`, so they
      // all share the change-set-wide one.
      expect(result.changeSet?.groups).toEqual([
        {
          id: 'one-card',
          opIndices: [0, 1, 2],
          revisionCount: expect.any(Number),
          restoresAppearance: true
        }
      ]);
      expect(result.changeSet?.formatTracking).toBe(
        'grouped_with_revision_cards'
      );
      // Side A's guarantee: every revision carries the durable tag.
      const tags = revisions(ed).map((rev) =>
        parseRevisionGroupTag(rev.customData)
      );
      expect(tags.length).toBeGreaterThan(1);
      expect(tags.every((tag) => tag?.group === 'one-card')).toBe(true);
      expect(listRevisionGroups(ed as unknown as LiveEditor)).toHaveLength(1);
      // There is genuinely something for the reject to undo, in both halves.
      expect(fills(ed, '0;1')).not.toEqual(originalFills);
      expect(rejectStream(ed)).not.toBe(ed.serialize());

      // One decision, taken from one member of the group.
      revisions(ed)[0].reject();

      expect(fills(ed, '0;1')).toEqual(originalFills);
      expect(facts(ed, '0;1').rowCount).toBe(originalRowCount);
      expect(rejectStream(ed)).toBe(originalRejectStream);
      expect(revisions(ed)).toHaveLength(0);
    } finally {
      destroyEditor(ed);
    }
  });

  it('accepts everything from one member too, appearance included', () => {
    const ed = makeEditor(twoTables());
    try {
      const result = apply(
        ed,
        [
          { op: 'insert_row', anchor: '0;1;2;0;0' },
          { op: 'set_cell_text', anchor: '0;1;3;0;0', text: '2a' }
        ],
        'accept-all'
      );
      expect(result.results.every((entry) => entry.ok)).toBe(true);
      const acceptedFills = fills(ed, '0;1');

      revisions(ed)[0].accept();

      // Accepting resolves the whole group - no card is left behind - and the
      // appearance the batch wrote simply stays, since accepting an appearance
      // write is a no-op by construction.
      expect(revisions(ed)).toHaveLength(0);
      expect(fills(ed, '0;1')).toEqual(acceptedFills);
      expect(facts(ed, '0;1').rows[3].cells[0].text).toBe('2a');
    } finally {
      destroyEditor(ed);
    }
  });
});

// The defect a naive merge produces. Side B collected ONE change-set-wide list
// of appearance restores; side A splits a change set into several accept groups.
// Bind the one list to every group and rejecting the card that changed nothing
// visual repaints a table the OTHER card was responsible for - a silent
// document-integrity failure, and exactly the reason the restores are bucketed
// by group id.
describe('appearance restores belong to their own group and no other', () => {
  const edits = [
    // 'sched-a' disturbs the banded table's stripe and repairs it.
    { op: 'insert_row', anchor: '0;1;2;0;0', group: 'sched-a' },
    // 'sched-b' is pure content, in the OTHER table.
    {
      op: 'set_cell_text',
      anchor: '0;2;1;0;0',
      text: 'rewritten',
      group: 'sched-b'
    }
  ];

  it('reports the appearance against only the group that wrote it', () => {
    const ed = makeEditor(twoTables());
    try {
      const result = apply(ed, edits, 'two-groups');
      expect(result.results.every((entry) => entry.ok)).toBe(true);
      const groups = result.changeSet?.groups ?? [];
      expect(groups.map((group) => group.id).sort()).toEqual([
        'sched-a',
        'sched-b'
      ]);
      expect(
        groups.find((group) => group.id === 'sched-a')?.restoresAppearance
      ).toBe(true);
      expect(
        groups.find((group) => group.id === 'sched-b')?.restoresAppearance
      ).toBeUndefined();
      expect(listRevisionGroups(ed as unknown as LiveEditor)).toHaveLength(2);
    } finally {
      destroyEditor(ed);
    }
  });

  it('rejecting the content-only group leaves the other table untouched', () => {
    const ed = makeEditor(twoTables());
    try {
      const originalPlainText = facts(ed, '0;2').rows[1].cells[0].text;
      apply(ed, edits, 'two-groups');
      const bandedAfterWrite = fills(ed, '0;1');
      const bandedRowsAfterWrite = facts(ed, '0;1').rowCount;

      rejectGroup(ed, 'sched-b');

      // Its own content is back...
      expect(facts(ed, '0;2').rows[1].cells[0].text).toBe(originalPlainText);
      // ...and the banded table is EXACTLY as 'sched-a' left it. A restore
      // replayed here would repaint rows whose insertion is still pending.
      expect(fills(ed, '0;1')).toEqual(bandedAfterWrite);
      expect(facts(ed, '0;1').rowCount).toBe(bandedRowsAfterWrite);
    } finally {
      destroyEditor(ed);
    }
  });

  it('rejecting the appearance group restores its table, and only its table', () => {
    const ed = makeEditor(twoTables());
    try {
      const originalBandedFills = fills(ed, '0;1');
      const originalBandedRows = facts(ed, '0;1').rowCount;
      apply(ed, edits, 'two-groups');
      const plainAfterWrite = facts(ed, '0;2').rows[1].cells[0].text;

      rejectGroup(ed, 'sched-a');

      expect(fills(ed, '0;1')).toEqual(originalBandedFills);
      expect(facts(ed, '0;1').rowCount).toBe(originalBandedRows);
      // The sibling group is untouched and still pending its own decision.
      expect(facts(ed, '0;2').rows[1].cells[0].text).toBe(plainAfterWrite);
      expect(listRevisionGroups(ed as unknown as LiveEditor)).toHaveLength(1);
    } finally {
      destroyEditor(ed);
    }
  });

  it('rejecting both groups restores the document byte for byte', () => {
    const ed = makeEditor(twoTables());
    try {
      const originalRejectStream = rejectStream(ed);
      const originalBandedFills = fills(ed, '0;1');
      apply(ed, edits, 'two-groups');

      rejectGroup(ed, 'sched-b');
      rejectGroup(ed, 'sched-a');

      expect(fills(ed, '0;1')).toEqual(originalBandedFills);
      expect(rejectStream(ed)).toBe(originalRejectStream);
      expect(revisions(ed)).toHaveLength(0);
    } finally {
      destroyEditor(ed);
    }
  });
});

// Side A's whole reason to exist, now proven against the real SDK rather than a
// fake: the tag is written by SyncFusion's own revision tagger, and it comes
// back when the document is reopened.
describe('the grouped card survives a save and reload', () => {
  const reopen = (ed: DocumentEditor) => makeEditor(JSON.parse(ed.serialize()));

  it('rebuilds the accept groups from the persisted customData', () => {
    const ed = makeEditor(twoTables());
    let reloaded: DocumentEditor | undefined;
    try {
      apply(
        ed,
        [
          { op: 'insert_row', anchor: '0;1;2;0;0', group: 'sched-a' },
          {
            op: 'set_cell_text',
            anchor: '0;2;1;0;0',
            text: 'rewritten',
            group: 'sched-b'
          }
        ],
        'persisted'
      );
      const liveGroups = listRevisionGroups(ed as unknown as LiveEditor).length;

      reloaded = reopen(ed);
      // The in-memory wrappers died with the old editor's JS objects...
      expect(
        revisions(reloaded).some((rev) => (rev as any).robinGroupBound)
      ).toBe(false);
      // ...but the tags came back through SFDT, so the groups can be rebuilt.
      expect(
        listRevisionGroups(reloaded as unknown as LiveEditor)
      ).toHaveLength(liveGroups);
      const bound = rebindRevisionGroups(reloaded as unknown as LiveEditor);
      expect(bound).toBe(revisions(reloaded).length);
      // Idempotent: a second pass finds nothing left to bind.
      expect(rebindRevisionGroups(reloaded as unknown as LiveEditor)).toBe(0);
    } finally {
      destroyEditor(ed);
      if (reloaded) destroyEditor(reloaded);
    }
  });

  it('still resolves a whole group from one member after the reload', () => {
    const ed = makeEditor(twoTables());
    let reloaded: DocumentEditor | undefined;
    try {
      const originalPlainText = facts(ed, '0;2').rows[1].cells[0].text;
      apply(
        ed,
        [
          {
            op: 'set_cell_text',
            anchor: '0;2;1;0;0',
            text: 'rewritten',
            group: 'sched-b'
          }
        ],
        'persisted'
      );
      reloaded = reopen(ed);
      rebindRevisionGroups(reloaded as unknown as LiveEditor);
      // A tracked replace is a Deletion revision plus an Insertion revision;
      // one decision has to resolve both, or the card splits in two after every
      // reload - which is the bug side A was written to fix.
      expect(revisions(reloaded).length).toBeGreaterThan(1);

      rejectGroup(reloaded, 'sched-b');

      expect(revisions(reloaded)).toHaveLength(0);
      expect(facts(reloaded, '0;2').rows[1].cells[0].text).toBe(
        originalPlainText
      );
    } finally {
      destroyEditor(ed);
      if (reloaded) destroyEditor(reloaded);
    }
  });

  it('restores exact appearance and content after reload + reject', () => {
    const sfdt: any = twoTables();
    const [source, target] = sfdt.sections[0].blocks.slice(1, 3);
    source.rows.forEach((rowEntry: any, rowIndex: number) => {
      rowEntry.cells.forEach((cellEntry: any) => {
        cellEntry.cellFormat.verticalAlignment =
          rowIndex % 2 ? 'Center' : 'Top';
        cellEntry.cellFormat.borders = {
          top: {
            lineStyle: 'Single',
            lineWidth: 0.75,
            color: '#1F4E78'
          },
          left: {
            lineStyle: 'Single',
            lineWidth: 0.75,
            color: '#1F4E78'
          },
          right: {
            lineStyle: 'Single',
            lineWidth: 0.75,
            color: '#1F4E78'
          },
          bottom: {
            lineStyle: 'Single',
            lineWidth: 0.75,
            color: '#1F4E78'
          }
        };
      });
    });
    target.rows.forEach((rowEntry: any, rowIndex: number) => {
      rowEntry.rowFormat.isHeader = rowIndex === 1;
      rowEntry.cells.forEach((cellEntry: any) => {
        cellEntry.cellFormat.verticalAlignment = 'Bottom';
        cellEntry.cellFormat.borders = {
          left: {
            lineStyle: 'Dash',
            lineWidth: 0.5,
            color: '#C00000'
          }
        };
      });
    });
    const ed = makeEditor(sfdt);
    let reloaded: DocumentEditor | undefined;
    try {
      const originalAppearance = appearanceSnapshot(ed, '0;2');
      const originalRowCount = facts(ed, '0;2').rowCount;
      const result = apply(
        ed,
        [
          { op: 'insert_row', anchor: '0;2;2;0;0' },
          {
            op: 'copy_table_format',
            anchor: '0;2;0;0;0',
            sourceTable: '0;1'
          }
        ],
        'reloaded-card'
      );
      expect(result.results.every((entry) => entry.ok)).toBe(true);
      expect(appearanceSnapshot(ed, '0;2')).not.toEqual(originalAppearance);
      expect(
        revisions(ed).every(
          (revision) =>
            parseRevisionGroupTag(revision.customData)?.appearanceRestores
              ?.length
        )
      ).toBe(true);

      reloaded = reopen(ed);
      rebindRevisionGroups(reloaded as unknown as LiveEditor);
      revisions(reloaded)[0].reject();

      expect(facts(reloaded, '0;2').rowCount).toBe(originalRowCount);
      expect(appearanceSnapshot(reloaded, '0;2')).toEqual(originalAppearance);
      expect(revisions(reloaded)).toHaveLength(0);
    } finally {
      destroyEditor(ed);
      if (reloaded) destroyEditor(reloaded);
    }
  });
});

describe('a rejected card puts back the layout the DOCUMENT stated', () => {
  it('does not write allowAutoFit:false or a point-width grid into a table that stated neither', () => {
    const ed = makeEditor(statedLayoutFixture());
    try {
      const before = statedTableLayout(ed, '0;2');
      expect(before).toEqual({
        allowAutoFit: true,
        preferredWidthType: 'Auto',
        cellWidthTypes: ['Auto', 'Auto']
      });

      const result = apply(
        ed,
        [
          { op: 'insert_row', group: 'sched', anchor: '0;2;1;0;0' },
          {
            op: 'copy_table_format',
            group: 'sched',
            anchor: '0;2;0;0;0',
            sourceTable: '0;1'
          }
        ],
        'stated-layout-card'
      );
      expect(result.results.every((entry) => entry.ok)).toBe(true);
      // The copy really did impose the source's fixed layout.
      expect(statedTableLayout(ed, '0;2')).toMatchObject({
        allowAutoFit: false,
        preferredWidthType: 'Point'
      });

      rejectGroup(ed, 'sched');

      expect(statedTableLayout(ed, '0;2')).toEqual(before);
      expect(revisions(ed)).toHaveLength(0);
    } finally {
      destroyEditor(ed);
    }
  });

  // The review rail never calls the native cascading reject: every card - chip,
  // group and rail-wide - resolves member by member through robinResolveSelf, so
  // the group's appearance inverse was never reached from the UI at all. Reject
  // cleared the content and left the shading behind.
  it('restores appearance when the rail rejects the group member by member', () => {
    const ed = makeEditor(statedLayoutFixture());
    try {
      const beforeAppearance = appearanceSnapshot(ed, '0;2');
      const beforeLayout = statedTableLayout(ed, '0;2');
      const beforeRowCount = facts(ed, '0;2').rowCount;

      const result = apply(
        ed,
        [
          { op: 'insert_row', group: 'sched', anchor: '0;2;1;0;0' },
          {
            op: 'copy_table_format',
            group: 'sched',
            anchor: '0;2;0;0;0',
            sourceTable: '0;1'
          }
        ],
        'rail-rejected-card'
      );
      expect(result.results.every((entry) => entry.ok)).toBe(true);
      expect(appearanceSnapshot(ed, '0;2')).not.toEqual(beforeAppearance);

      const live = ed as unknown as LiveEditor;
      resolveLiveRevisionGroupsAsOneUndo(
        live,
        listRevisionGroups(live).filter((view) => view.group === 'sched'),
        false
      );

      expect(revisions(ed)).toHaveLength(0);
      expect(facts(ed, '0;2').rowCount).toBe(beforeRowCount);
      expect(appearanceSnapshot(ed, '0;2')).toEqual(beforeAppearance);
      expect(statedTableLayout(ed, '0;2')).toEqual(beforeLayout);
    } finally {
      destroyEditor(ed);
    }
  });

  it('keeps the appearance when one member of the group was accepted', () => {
    const ed = makeEditor(statedLayoutFixture());
    try {
      const beforeAppearance = appearanceSnapshot(ed, '0;2');
      apply(
        ed,
        [
          { op: 'insert_row', group: 'sched', anchor: '0;2;1;0;0' },
          { op: 'set_cell_text', group: 'sched', anchor: '0;2;2;1;0', text: 'Z St' },
          {
            op: 'copy_table_format',
            group: 'sched',
            anchor: '0;2;0;0;0',
            sourceTable: '0;1'
          }
        ],
        'partly-accepted-card'
      );
      const applied = appearanceSnapshot(ed, '0;2');
      const live = ed as unknown as LiveEditor;
      const view = listRevisionGroups(live).find(
        (entry) => entry.group === 'sched'
      );
      expect(view).toBeDefined();
      const items = (view as any).items;
      expect(items.length).toBeGreaterThan(1);

      // Accept one chip, then reject the rest: part of the change survives, so
      // repainting the table would undo appearance the survivor still needs.
      resolveRevisionsAsOneUndo(live, [items[0].revision], true);
      resolveRevisionsAsOneUndo(
        live,
        items.slice(1).map((item: any) => item.revision),
        false
      );

      expect(appearanceSnapshot(ed, '0;2')).toEqual(applied);
      expect(appearanceSnapshot(ed, '0;2')).not.toEqual(beforeAppearance);
    } finally {
      destroyEditor(ed);
    }
  });
});
