type FieldObject = {
  id: string;
  type: string;
  value?: unknown;
  exportValues?: string | string[];
};

const exportValueOf = (obj: FieldObject): string => {
  if (Array.isArray(obj.exportValues)) return obj.exportValues[0] ?? 'Yes';
  return obj.exportValues ?? 'Yes';
};

export async function extractFieldValues(
  pdfDoc: any
): Promise<Record<string, string>> {
  const fieldObjects: Record<string, FieldObject[]> | null =
    await pdfDoc.getFieldObjects();
  if (!fieldObjects || Object.keys(fieldObjects).length === 0) {
    console.warn('Feathery: document has no fillable form fields');
    return {};
  }
  const storage: Record<string, { value?: unknown }> =
    pdfDoc.annotationStorage.getAll() ?? {};

  const values: Record<string, string> = {};
  Object.entries(fieldObjects).forEach(([name, objs]) => {
    objs.forEach((obj) => {
      const stored = storage[obj.id];
      switch (obj.type) {
        case 'text':
        case 'combobox':
        case 'listbox': {
          const val = stored ? stored.value : obj.value;
          values[name] = val == null ? '' : String(val);
          break;
        }
        case 'checkbox':
        case 'radiobutton': {
          const exportValue = exportValueOf(obj);
          const checked = stored
            ? Boolean(stored.value)
            : obj.value === exportValue;
          if (checked) values[name] = exportValue;
          else if (!(name in values)) values[name] = '';
          break;
        }
        default:
          break;
      }
    });
  });
  return values;
}

export function toFormFields(
  values: Record<string, string>
): { FieldName: string; FieldValue: string }[] {
  return Object.entries(values).map(([FieldName, FieldValue]) => ({
    FieldName,
    FieldValue
  }));
}
