// A click on a row of a Data Hub table can store the row's entry id in a form
// field (so a data-driven container on another step loads that entry) and then
// go to a step. Both are builder settings on the table; either may be unset.
type RowClickTable = {
  properties?: {
    row_click_entry_field_key?: string;
    row_click_step?: string;
  };
};

type RowClickPayload = {
  entryId?: string;
  // Set for row-action buttons, which are not row clicks.
  action?: string;
};

export type ResolvedRowClick = {
  entryFieldKey?: string;
  entryId?: string;
  nextStepKey?: string;
};

export function hasRowClick(table: RowClickTable): boolean {
  const props = table.properties ?? {};
  return !!(props.row_click_entry_field_key || props.row_click_step);
}

export function resolveTableRowClick(
  table: RowClickTable,
  payload: RowClickPayload,
  steps: Record<string, { id?: string; key?: string }>
): ResolvedRowClick {
  if (payload.action !== undefined) return {};
  const props = table.properties ?? {};
  const resolved: ResolvedRowClick = {};
  // Only a persisted Hub row has an entry id; a row still being added does not.
  if (props.row_click_entry_field_key && payload.entryId) {
    resolved.entryFieldKey = props.row_click_entry_field_key;
    resolved.entryId = payload.entryId;
  }
  if (props.row_click_step) {
    // The builder stores the step's id; navigation runs on keys.
    const step = Object.values(steps).find(
      (s) => s.id === props.row_click_step
    );
    if (step?.key) resolved.nextStepKey = step.key;
  }
  return resolved;
}
