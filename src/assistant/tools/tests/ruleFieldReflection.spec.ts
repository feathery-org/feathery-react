// End-to-end proof of field-change reflection: a designer-defined rule that
// only MUTATES a form field (returns nothing) must surface the change as a
// derived document update whose data actually drives a landing tracked edit
// on a real SyncFusion DocumentEditor - the captain's advisor-title case.
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
  findDocumentOccurrences,
  flattenSfdt,
  LiveEditor
} from '../syncfusionDocumentOps';
import { dispatchAssistantTool } from '../assistantToolDispatch';
import { runLogicRuleById } from '../../../Form/logic';
import internalState from '../../../utils/internalState';

jest.mock('../../../utils/init', () => {
  const actual = jest.requireActual('../../../utils/init');
  return { ...actual, setFieldValues: jest.fn() };
});
jest.mock('../../../utils/formContext', () => ({ getFormContext: () => ({}) }));
jest.mock('../../../utils/sensitiveActions', () => ({
  getPrivateActions: () => ({})
}));
jest.mock('../../../utils/formHelperFunctions', () => ({
  httpHelpers: () => ({}),
  processFileValues: jest.fn(),
  rerenderAllForms: jest.fn()
}));

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

const jsdomGetComputedStyle = window.getComputedStyle.bind(window);
window.getComputedStyle = ((elt: Element) =>
  jsdomGetComputedStyle(elt)) as typeof window.getComputedStyle;

if (!(window.SVGElement.prototype as any).getBBox) {
  (window.SVGElement.prototype as any).getBBox = () =>
    ({ x: 0, y: 0, width: 0, height: 0 } as DOMRect);
}

function makeRealDocumentEditor(sfdt: any): DocumentEditor {
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

function destroyRealDocumentEditor(editor: DocumentEditor): void {
  const host = editor.element;
  editor.destroy();
  host?.remove();
}

const blockTexts = (editor: DocumentEditor) =>
  flattenSfdt(JSON.parse(editor.serialize())).map((block) => block.text);

const FORM = 'form-uuid-reflect';

const TITLE_RULE = {
  id: 'c07cc11e-c8be-4a1f-9d7c-f45ced1cd761',
  name: 'FM Set Advisor Title',
  trigger_event: 'tool',
  server_side: false,
  enabled: true,
  valid: true,
  code: 'PE_AETitle.value = feathery.params.title;'
};

const seed = (fields: Record<string, any>) => {
  internalState[FORM] = {
    client: { runServerSideLogicRule: jest.fn() },
    logicRules: [TITLE_RULE],
    fields,
    extractedSharedCodeInfo: [],
    connectorFields: {}
  } as any;
};

const dispatchTitleRule = (input: Record<string, any>) =>
  dispatchAssistantTool('rule_fm_set_advisor_title_c07c', input, {
    callableRules: [
      {
        id: TITLE_RULE.id,
        name: TITLE_RULE.name,
        server_side: false
      }
    ],
    runLogicRule: (ruleId, inputParams) =>
      runLogicRuleById(ruleId, inputParams, FORM, { documentPresent: true })
  });

afterEach(() => {
  Object.keys(internalState).forEach((k) => delete (internalState as any)[k]);
  jest.clearAllMocks();
});

describe('field-mutating rule -> derived update -> landing document edit', () => {
  it('real SDK: the surfaced previous/value drive a tracked replace that lands in the document', async () => {
    seed({ PE_AETitle: { value: 'Risk Advisor' } });
    const ed = makeRealDocumentEditor({
      sections: [
        {
          blocks: [
            { inlines: [{ text: 'Client Services' }] },
            { inlines: [{ text: 'Jordan Smith, Risk Advisor' }] }
          ]
        }
      ]
    });

    try {
      const dispatched = await dispatchTitleRule({ title: 'Sr. Risk Advisor' });
      expect(dispatched.handled).toBe(true);
      const output = dispatched.output as any;

      // The rule returned nothing, but the field mutation is surfaced with
      // the before and after values...
      expect(output.result).toBeNull();
      expect(output.fieldChanges).toHaveLength(1);
      const update = output.fieldChanges[0];
      expect(update).toMatchObject({
        key: 'PE_AETitle',
        before: 'Risk Advisor',
        after: 'Sr. Risk Advisor'
      });

      // The reflection path the model follows: search the previous text live,
      // then one anchored tracked replace per occurrence.
      const found = findDocumentOccurrences(ed as unknown as LiveEditor, {
        text: update.before,
        matchCase: false
      });
      expect(found.ok).toBe(true);
      expect(found.count).toBe(1);
      const occurrence = found.occurrences[0];

      ed.enableTrackChanges = true;
      const applied = applyDocumentEdits(ed as unknown as LiveEditor, {
        changeSetId: 'reflect-title',
        edits: [
          {
            op: 'replace_text',
            anchor: occurrence.anchor,
            find: occurrence.matchText,
            replace: update.after,
            expect: occurrence.blockText,
            start: occurrence.start,
            end: occurrence.end
          }
        ]
      });
      expect(applied.results[0]).toMatchObject({ ok: true, op: 'replace_text' });

      // The edit LANDED: the document now shows the new title, tracked.
      expect(blockTexts(ed)).toContain('Jordan Smith, Sr. Risk Advisor');
      expect(blockTexts(ed)).not.toContain('Jordan Smith, Risk Advisor');
    } finally {
      destroyRealDocumentEditor(ed);
    }
  });

  it('real SDK: when the document holds an OLDER rendering than the pre-rule value, describes enables the fallback instead of a silent skip', async () => {
    // The captain's exact live divergence: the document was generated when the
    // field said "Risk Advisor"; the field was later set to "Engineer" without
    // regenerating, so searching the pre-rule value finds nothing.
    seed({ PE_AETitle: { value: 'Engineer' } });
    const ed = makeRealDocumentEditor({
      sections: [
        { blocks: [{ inlines: [{ text: 'Jordan Smith, Risk Advisor' }] }] }
      ]
    });

    try {
      const dispatched = await dispatchTitleRule({ title: 'Sr. Risk Advisor' });
      const output = dispatched.output as any;
      const update = output.fieldChanges[0];
      expect(update).toMatchObject({
        key: 'PE_AETitle',
        before: 'Engineer',
        after: 'Sr. Risk Advisor'
      });

      // The exact-text search honestly comes up empty - not a crash, and per
      // the contract NOT a success either.
      const found = findDocumentOccurrences(ed as unknown as LiveEditor, {
        text: update.before,
        matchCase: false
      });
      expect(found.ok).toBe(true);
      expect(found.count).toBe(0);

      // The update carries what the text IS, so reflection can fall back to
      // semantic search instead of silently skipping...
      expect(update.documentHint.describes).toBe(
        "the rendered value of form field 'PE_AETitle'"
      );
    } finally {
      destroyRealDocumentEditor(ed);
    }
  });
});
