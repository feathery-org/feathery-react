// `getFormFields`: the tool that wedged the conversation.
//
// Live evidence (captain, 2026-07-27): ai-services declares `getFormFields`
// client-forwarded with NO server execute, and no browser build - this branch or
// master - had a handler for it. The server side looked perfectly healthy: the
// POST streamed `tool-call getFormFields` and completed normally in 7.2s. But no
// result was ever coming, because `lastAssistantMessageIsCompleteWithToolCalls`
// only fires once every streamed tool call has an output, so the auto-
// continuation never fired. No error, no answer, forever. Two of that day's
// three "hangs" were this one tool (turn A4 "increment it by one" at 09:26, and
// the 10:51 endorsements question).
//
// Grep proof from the 2.2GB log: `tool-call getFormFields` appears twice, and
// ZERO request bodies anywhere carry a `tool-getFormFields` part in any state -
// the client has never once answered this tool.
//
// Two things are tested here: the handler now returns the contract ai-services
// advertises, and - the durable half - ANY tool the dispatch does not recognise
// resolves to a visible error instead of silence.
import internalState from '../../../utils/internalState';
import {
  dispatchAssistantTool,
  unhandledToolOutput
} from '../assistantToolDispatch';
import { dispatchGetFormFields } from '../getFormFields';

const FORM = 'test-form';

const servar = (key: string, type: string, name?: string) => ({
  servar: { key, type, ...(name ? { name } : {}) }
});

/**
 * A two-step form with visible servars on both steps plus hidden fields, which
 * is the shape the tool exists for: the per-turn live-state block only ever
 * describes the CURRENT step and caps its hidden-field map.
 */
function installForm(): void {
  (internalState as any)[FORM] = {
    currentStep: { id: 'step-1', key: 'intro' },
    steps: {
      intro: {
        servar_fields: [
          servar('advisor_name', 'text_field', 'Advisor Name'),
          servar('PE_AETitle', 'text_field', 'Advisor Title')
        ]
      },
      // A second step: its fields are invisible to the live-state block, and the
      // tool description promises "fields on other steps".
      coverage: {
        servar_fields: [
          servar('premium_total', 'integer_field', 'Total Premium'),
          servar('unset_field', 'text_field', 'Never Filled')
        ]
      }
    },
    fields: {
      advisor_name: { value: 'Tyler Marlow' },
      PE_AETitle: { value: 'Engineer' },
      premium_total: { value: 41250 },
      unset_field: { value: '' },
      // Hidden/computed fields - no servar anywhere, so no label/type/stepKey.
      hidden_org_id: { value: 'org_5' },
      hidden_quote_ref: { value: 'Q-2026-0731' },
      hidden_empty: { value: '' }
    }
  };
}

afterEach(() => {
  delete (internalState as any)[FORM];
});

describe('getFormFields: keys mode', () => {
  beforeEach(installForm);

  it("THE CAPTAIN'S A4 TURN: an exact key fetch answers with the live value", () => {
    const result = dispatchGetFormFields(FORM, { keys: ['PE_AETitle'] }) as any;

    expect(result.ok).toBe(true);
    expect(result.mode).toBe('keys');
    expect(result.fields).toEqual([
      {
        key: 'PE_AETitle',
        found: true,
        hidden: false,
        value: 'Engineer',
        type: 'text_field',
        label: 'Advisor Title',
        stepKey: 'intro'
      }
    ]);
  });

  it('distinguishes an EMPTY field from a NONEXISTENT one', () => {
    const result = dispatchGetFormFields(FORM, {
      keys: ['unset_field', 'no_such_field']
    }) as any;

    // The description promises exactly this: empty values are included so the
    // model can tell empty from nonexistent, and unknown keys come back found:false.
    expect(result.fields[0]).toMatchObject({
      key: 'unset_field',
      found: true,
      value: ''
    });
    expect(result.fields[1]).toMatchObject({
      key: 'no_such_field',
      found: false,
      value: null
    });
  });

  it('reads a field on a step the user is not on', () => {
    const result = dispatchGetFormFields(FORM, { keys: ['premium_total'] }) as any;

    expect(result.fields[0]).toMatchObject({
      key: 'premium_total',
      value: 41250,
      stepKey: 'coverage',
      type: 'integer_field'
    });
  });

  it('a hidden field carries no label, type or stepKey', () => {
    const result = dispatchGetFormFields(FORM, { keys: ['hidden_org_id'] }) as any;

    expect(result.fields[0]).toEqual({
      key: 'hidden_org_id',
      found: true,
      hidden: true,
      value: 'org_5'
    });
  });

  it('keys mode takes precedence over search/scope', () => {
    const result = dispatchGetFormFields(FORM, {
      keys: ['PE_AETitle'],
      search: 'premium',
      scope: 'hidden'
    }) as any;

    expect(result.mode).toBe('keys');
    expect(result.fields.map((f: any) => f.key)).toEqual(['PE_AETitle']);
  });

  it('caps a keys request at 100 and reports the remainder as omitted', () => {
    const keys = Array.from({ length: 130 }, (_, i) => `k${i}`);

    const result = dispatchGetFormFields(FORM, { keys }) as any;

    expect(result.fields).toHaveLength(100);
    expect(result.total).toBe(130);
    expect(result.omitted).toBe(30);
  });
});

describe('getFormFields: scan mode', () => {
  beforeEach(installForm);

  it('skips empty values by default and includes them on request', () => {
    const withoutEmpty = dispatchGetFormFields(FORM, { search: 'unset' }) as any;
    expect(withoutEmpty.fields).toHaveLength(0);

    const withEmpty = dispatchGetFormFields(FORM, {
      search: 'unset',
      includeEmpty: true
    }) as any;
    expect(withEmpty.fields.map((f: any) => f.key)).toEqual(['unset_field']);
  });

  it("scope 'hidden' returns only hidden fields, 'fields' only servars", () => {
    const hidden = dispatchGetFormFields(FORM, { scope: 'hidden' }) as any;
    expect(hidden.fields.every((f: any) => f.hidden)).toBe(true);
    expect(hidden.fields.map((f: any) => f.key).sort()).toEqual([
      'hidden_org_id',
      'hidden_quote_ref'
    ]);

    const visible = dispatchGetFormFields(FORM, { scope: 'fields' }) as any;
    expect(visible.fields.every((f: any) => !f.hidden)).toBe(true);
  });

  it('matches the user-facing label, not just the key', () => {
    // "Total Premium" is the label of `premium_total`; a key-only search for
    // "Total Prem" would find nothing.
    const result = dispatchGetFormFields(FORM, { search: 'Total Prem' }) as any;

    expect(result.fields.map((f: any) => f.key)).toEqual(['premium_total']);
  });

  it('matchValues finds the field holding a known value', () => {
    const without = dispatchGetFormFields(FORM, { search: 'Q-2026-0731' }) as any;
    expect(without.fields).toHaveLength(0);

    const withValues = dispatchGetFormFields(FORM, {
      search: 'Q-2026-0731',
      matchValues: true
    }) as any;
    expect(withValues.fields.map((f: any) => f.key)).toEqual(['hidden_quote_ref']);
  });

  it('ranks exact key first, then key-prefix, then alphabetical', () => {
    (internalState as any)[FORM].fields = {
      title: { value: 'exact' },
      title_suffix: { value: 'prefix' },
      a_title_holder: { value: 'substring' }
    };

    const result = dispatchGetFormFields(FORM, { search: 'title' }) as any;

    expect(result.fields.map((f: any) => f.key)).toEqual([
      'title',
      'title_suffix',
      'a_title_holder'
    ]);
  });

  it('paginates with offset and reports total and omitted', () => {
    (internalState as any)[FORM].fields = Object.fromEntries(
      Array.from({ length: 10 }, (_, i) => [`h${i}`, { value: `v${i}` }])
    );

    const page = dispatchGetFormFields(FORM, { limit: 4, offset: 4 }) as any;

    expect(page.fields).toHaveLength(4);
    expect(page.total).toBe(10);
    expect(page.offset).toBe(4);
    // 10 total, 4 skipped, 4 returned -> 2 still unseen.
    expect(page.omitted).toBe(2);
  });

  it('clamps limit to 200 and defaults to 50', () => {
    (internalState as any)[FORM].fields = Object.fromEntries(
      Array.from({ length: 260 }, (_, i) => [`h${i}`, { value: `v${i}` }])
    );

    expect((dispatchGetFormFields(FORM, {}) as any).fields).toHaveLength(50);
    expect(
      (dispatchGetFormFields(FORM, { limit: 999 }) as any).fields
    ).toHaveLength(200);
  });

  it('flags a clamped value and a targeted keys re-fetch returns more of it', () => {
    const long = 'x'.repeat(4000);
    (internalState as any)[FORM].fields = { notes: { value: long } };

    const scanned = (dispatchGetFormFields(FORM, { search: 'notes' }) as any)
      .fields[0];
    expect(scanned.valueTruncated).toBe(true);
    expect((scanned.value as string).length).toBe(500);

    // The description tells the model to re-fetch a truncated entry via `keys`
    // "for the fuller value" - so that has to actually return more.
    const refetched = (dispatchGetFormFields(FORM, { keys: ['notes'] }) as any)
      .fields[0];
    expect(refetched.value).toBe(long);
    expect(refetched.valueTruncated).toBeUndefined();
  });

  it('refuses cleanly when no form is connected, rather than throwing', () => {
    const result = dispatchGetFormFields('no-such-form', {}) as any;

    expect(result).toMatchObject({ ok: false, error: 'no_form_state' });
  });
});

describe('the dispatch answers every tool call it is given', () => {
  beforeEach(installForm);

  it.each(['getFormFields', 'get_form_fields'])(
    'routes %s to the live form handler',
    async (toolName) => {
      const result = await dispatchAssistantTool(
        toolName,
        { keys: ['PE_AETitle'] },
        { getFormFields: (input) => dispatchGetFormFields(FORM, input) }
      );

      expect(result.handled).toBe(true);
      expect(result.output).toMatchObject({ ok: true, mode: 'keys' });
    }
  );

  it('getFormFields with no host handler still returns an output, not silence', async () => {
    const result = await dispatchAssistantTool('getFormFields', {}, {});

    // The wedge was the ABSENCE of an output. Any output ends the turn.
    expect(result.handled).toBe(true);
    expect(result.output).toMatchObject({
      ok: false,
      error: 'handler_unavailable'
    });
  });

  it('a tool nothing recognises produces an actionable error output', () => {
    const output = unhandledToolOutput('someToolShippedAheadOfThisClient') as any;

    expect(output.ok).toBe(false);
    expect(output.error).toBe('unhandled_tool');
    // Names the tool, and tells the model not to spend the turn retrying it.
    expect(output.message).toContain('someToolShippedAheadOfThisClient');
    expect(output.message).toContain('Do not retry');
  });
});
