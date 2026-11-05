import { createFormToolActions } from './handlers';
import type { FormContext } from '../../types/Form';

class BridgeActionError extends Error {
  readonly result: Record<string, unknown>;
  constructor(message: string, result: Record<string, unknown>) {
    super(message);
    this.result = result;
  }
}
const fail = (code: string, result: { message: string }) =>
  new BridgeActionError(code, result);

function liveDocument() {
  const answer = jest.fn((payload: unknown) => ({
    status: 'ok' as const,
    result: { ok: true, editorId: 'editor-1', echo: payload }
  }));
  return {
    answer,
    accessor: { outline: answer, read: answer, find: answer, write: answer }
  };
}

function formContext(overrides: Record<string, unknown> = {}) {
  return {
    snapshot: jest.fn(() => ({ currentStep: { id: 'step-1' } })),
    fillFields: jest.fn(async () => ({ ok: true, rejected: [] })),
    navigateToStep: jest.fn(async () => ({ ok: true })),
    clickElement: jest.fn(async () => ({ ok: true })),
    runLogicRule: jest.fn(async () => ({ ok: true })),
    getTableRows: jest.fn(() => ({ ok: true })),
    deleteTableRow: jest.fn(() => ({ ok: true })),
    triggerTableAction: jest.fn(async () => ({ ok: true })),
    liveDocument: liveDocument().accessor,
    ...overrides
  } as unknown as FormContext;
}

const actionsFor = (context: FormContext | null) =>
  createFormToolActions({
    getContext: () => context,
    fail,
    downloadAttachment: jest.fn()
  });

const payload = {
  turnId: 't'.repeat(64),
  editorId: 'editor-1',
  target: { type: 'envelope', id: 'env-1' },
  input: { ids: ['n1'] }
};

describe('the action map', () => {
  test('queues the writes to the live step and leaves the reads free', () => {
    const actions = actionsFor(null);
    const queued = Object.keys(actions).filter((name) => actions[name].render);
    expect(queued).toEqual([
      'set_field_values',
      'navigate_to_step',
      'click_element',
      'run_logic_rule',
      'set_table_cells',
      'add_table_row',
      'delete_table_row',
      'trigger_table_action',
      'set_table_findings',
      'focus_table_cell',
      'document_write'
    ]);
    expect(actions.get_form_state.render).toBe(false);
    expect(actions.document_read.render).toBe(false);
  });
});

describe('form actions', () => {
  test('answers that the form has not loaded before it has', async () => {
    const actions = actionsFor(null);
    await expect(actions.get_form_state.run({})).resolves.toEqual({
      loaded: false
    });
    await expect(
      actions.set_field_values.run({ fields: [] })
    ).resolves.toMatchObject({ ok: false, reason: 'not_loaded' });
  });

  test('reads the screen the person sees', async () => {
    const context = formContext();
    await expect(actionsFor(context).get_form_state.run({})).resolves.toEqual({
      currentStep: { id: 'step-1' }
    });
  });

  test('hands each payload to the form the way the person would act', async () => {
    const context = formContext();
    const actions = actionsFor(context);
    const fields = [{ key: 'name', value: 'Ada' }];

    await actions.set_field_values.run({ fields });
    await actions.click_element.run({ elementId: 'button-1', repeatIndex: 2 });
    await actions.delete_table_row.run({ tableId: 'table-1', rowIndex: 3 });
    await actions.trigger_table_action.run({
      tableId: 'table-1',
      actionLabel: 'Approve',
      rowIndex: 0
    });

    expect(context.fillFields).toHaveBeenCalledWith(fields);
    expect(context.clickElement).toHaveBeenCalledWith('button-1', 2);
    expect(context.deleteTableRow).toHaveBeenCalledWith('table-1', {
      rowIndex: 3
    });
    expect(context.triggerTableAction).toHaveBeenCalledWith(
      'table-1',
      { rowIndex: 0 },
      'Approve'
    );
  });
});

describe('attached files', () => {
  const download = (files: Record<string, string>) =>
    jest.fn(async (attachmentId: string) => {
      if (!(attachmentId in files)) throw new Error('HTTP 404');
      return {
        blob: new Blob(['bytes']),
        mediaType: 'application/pdf',
        filename: files[attachmentId]
      };
    });

  const fillWith = (
    context: FormContext,
    downloadAttachment: ReturnType<typeof download>,
    fields: unknown[]
  ) =>
    createFormToolActions({
      getContext: () => context,
      fail,
      downloadAttachment
    }).set_field_values.run({ fields });

  test('enters attached files as files and leaves other values as they are', async () => {
    const fillFields = jest.fn(async () => ({
      ok: true,
      applied: [],
      rejected: []
    }));

    await fillWith(
      formContext({ fillFields }),
      download({ a1: 'id.pdf', a2: 'w2.pdf' }),
      [
        { key: 'name', value: 'Ada' },
        { key: 'docs', value: { attachmentIds: ['a1', 'a2'] }, repeatIndex: 1 }
      ]
    );

    const [name, docs] = (fillFields.mock.calls[0] as any[])[0];
    expect(name).toEqual({ key: 'name', value: 'Ada' });
    expect(docs.repeatIndex).toBe(1);
    expect(
      docs.value.map((file: File) => [
        file instanceof File,
        file.name,
        file.type
      ])
    ).toEqual([
      [true, 'id.pdf', 'application/pdf'],
      [true, 'w2.pdf', 'application/pdf']
    ]);
  });

  test('rejects only the field whose attachment cannot be loaded', async () => {
    const fillFields = jest.fn(async () => ({
      ok: true,
      applied: [{ key: 'name', value: 'Ada', priorValue: '' }],
      rejected: []
    }));

    const result = await fillWith(
      formContext({ fillFields }),
      download({ a1: 'id.pdf' }),
      [
        { key: 'name', value: 'Ada' },
        { key: 'docs', value: { attachmentIds: ['a1', 'missing'] } }
      ]
    );

    expect((fillFields.mock.calls[0] as any[])[0]).toEqual([
      { key: 'name', value: 'Ada' }
    ]);
    expect(result).toMatchObject({
      applied: [{ key: 'name' }],
      rejected: [
        {
          key: 'docs',
          reason: 'attachment_unavailable',
          message: expect.stringContaining('HTTP 404')
        }
      ]
    });
  });

  test('returns the form refusal as it is', async () => {
    const notLoaded = {
      ok: false,
      reason: 'not_loaded',
      message: 'Not loaded.'
    };

    await expect(
      fillWith(
        formContext({ fillFields: jest.fn(async () => notLoaded) }),
        download({}),
        [{ key: 'docs', value: { attachmentIds: ['missing'] } }]
      )
    ).resolves.toEqual(notLoaded);
  });
});

describe('document actions', () => {
  test.each(['outline', 'read', 'find', 'write'] as const)(
    'hands a %s payload to the document untouched and answers with its result',
    async (verb) => {
      const { accessor, answer } = liveDocument();
      const actions = actionsFor(formContext({ liveDocument: accessor }));
      await expect(
        actions[`document_${verb}`].run(payload)
      ).resolves.toMatchObject({ ok: true, echo: payload });
      expect(answer).toHaveBeenCalledWith(payload);
    }
  );

  test('fails as not-mounted when the form has no document', async () => {
    await expect(
      actionsFor(null).document_write.run(payload)
    ).rejects.toMatchObject({ message: 'not-mounted' });
  });

  test.each(['not-mounted', 'wrong-editor', 'handler-exception'] as const)(
    'fails with the engine’s typed %s code, its prose in result.message',
    async (code) => {
      const { accessor, answer } = liveDocument();
      answer.mockReturnValueOnce({
        status: 'error',
        error: code,
        result: { message: 'the engine could not answer' }
      } as never);
      const failure = await actionsFor(formContext({ liveDocument: accessor }))
        .document_read.run(payload)
        .catch((error: unknown) => error);
      expect(failure).toBeInstanceOf(BridgeActionError);
      expect(failure).toMatchObject({
        message: code,
        result: { message: 'the engine could not answer' }
      });
    }
  );

  test('names a document that throws anyway as a handler exception', async () => {
    const { accessor, answer } = liveDocument();
    answer.mockImplementationOnce(() => {
      throw new Error('engine blew up');
    });
    await expect(
      actionsFor(formContext({ liveDocument: accessor })).document_find.run(
        payload
      )
    ).rejects.toMatchObject({
      message: 'handler-exception',
      result: { message: 'engine blew up' }
    });
  });
});
