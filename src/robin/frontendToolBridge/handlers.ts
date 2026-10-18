import type { FormContext } from '../../types/Form';
import type { FillFieldInput } from '../../utils/formActions/fillFields';
import type { RunLogicRuleParams } from '../../utils/formActions/runLogicRule';
import type {
  SetTableCellsInput,
  SetTableFindingsInput,
  TableRowTarget
} from '../../utils/formActions/tables';

const FORM_NOT_LOADED = {
  ok: false,
  reason: 'not_loaded',
  message: 'The form has not loaded yet.'
};

export interface FormToolHandlerDeps {
  getContext: () => FormContext | null;
  fail: (code: string, result: { message: string }) => Error;
}

export interface FormToolAction {
  run: (payload: Record<string, unknown>) => Promise<Record<string, unknown>>;
  render: boolean;
}

type DocumentVerb = 'outline' | 'read' | 'find' | 'write';

function createFormToolHandlers({ getContext, fail }: FormToolHandlerDeps) {
  const withForm = async (act: (context: FormContext) => unknown) => {
    const context = getContext();
    return context ? act(context) : FORM_NOT_LOADED;
  };

  const documentHandler =
    (verb: DocumentVerb) => async (payload: Record<string, unknown>) => {
      const accessor = getContext()?.liveDocument;
      if (!accessor)
        throw fail('not-mounted', {
          message: 'No document editor is open on this form.'
        });
      let outcome: ReturnType<typeof accessor[DocumentVerb]>;
      try {
        outcome = accessor[verb](payload);
      } catch (error) {
        throw fail('handler-exception', {
          message: error instanceof Error ? error.message : String(error)
        });
      }
      if (outcome.status === 'error') throw fail(outcome.error, outcome.result);
      return outcome.result;
    };

  return {
    get_form_state: async () => getContext()?.snapshot() ?? { loaded: false },
    set_field_values: (payload: Record<string, unknown>) =>
      withForm((context) =>
        context.fillFields(payload.fields as FillFieldInput[])
      ),
    navigate_to_step: (payload: Record<string, unknown>) =>
      withForm((context) => context.navigateToStep(payload.stepKey as string)),
    click_element: (payload: Record<string, unknown>) =>
      withForm((context) =>
        context.clickElement(
          payload.elementId as string,
          payload.repeatIndex as number | undefined
        )
      ),
    run_logic_rule: (payload: Record<string, unknown>) =>
      withForm((context) =>
        context.runLogicRule(
          payload.ruleId as string,
          payload.params as RunLogicRuleParams | undefined
        )
      ),
    get_table_rows: ({ tableId, ...query }: Record<string, unknown>) =>
      withForm((context) =>
        context.getTableRows(
          tableId as string,
          query as { offset?: number; limit?: number; search?: string }
        )
      ),
    set_table_cells: (payload: Record<string, unknown>) =>
      withForm((context) =>
        context.setTableCells(
          payload.tableId as string,
          payload.cells as SetTableCellsInput[]
        )
      ),
    add_table_row: (payload: Record<string, unknown>) =>
      withForm((context) => context.addTableRow(payload.tableId as string)),
    delete_table_row: ({ tableId, ...target }: Record<string, unknown>) =>
      withForm((context) =>
        context.deleteTableRow(tableId as string, target as TableRowTarget)
      ),
    trigger_table_action: ({
      tableId,
      actionLabel,
      ...target
    }: Record<string, unknown>) =>
      withForm((context) =>
        context.triggerTableAction(
          tableId as string,
          target as TableRowTarget,
          actionLabel as string | undefined
        )
      ),
    set_table_findings: (payload: Record<string, unknown>) =>
      withForm((context) =>
        context.setTableFindings(
          payload.tableId as string,
          payload.findings as SetTableFindingsInput[]
        )
      ),
    focus_table_cell: ({ tableId, ...target }: Record<string, unknown>) =>
      withForm((context) =>
        context.focusTableCell(
          tableId as string,
          target as TableRowTarget & { fieldKey?: string }
        )
      ),
    get_table_issues: ({ tableId, ...query }: Record<string, unknown>) =>
      withForm((context) =>
        context.getTableIssues(
          tableId as string,
          query as TableRowTarget & { scope: 'table' | 'row' }
        )
      ),
    document_outline: documentHandler('outline'),
    document_read: documentHandler('read'),
    document_find: documentHandler('find'),
    document_write: documentHandler('write')
  };
}

type FormToolActionName = keyof ReturnType<typeof createFormToolHandlers>;

// Writes share the person's live step, so the bridge runs them one at a time
const RENDER_ACTIONS: ReadonlySet<string> = new Set<FormToolActionName>([
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

export function createFormToolActions(
  deps: FormToolHandlerDeps
): Record<string, FormToolAction> {
  return Object.fromEntries(
    Object.entries(createFormToolHandlers(deps)).map(([name, run]) => [
      name,
      { run: run as FormToolAction['run'], render: RENDER_ACTIONS.has(name) }
    ])
  );
}
