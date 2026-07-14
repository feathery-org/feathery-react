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

// pdf.js exposes AcroForm-qualified field names (e.g. `1own.H.1own_H_Addr123`),
// but Quik's FormFields API expects its own field names (e.g. `1own.H.Addr123`).
// The leaf segment of the qualified name is the Quik field name with '.' encoded
// as '_'. Decode it back; fall back to the full qualified name when the leaf
// has no encoded separator (simple/flat field names).
export function toQuikFieldName(qualifiedName: string): string {
  const leaf = qualifiedName.split('.').pop() ?? qualifiedName;
  return leaf.includes('_') ? leaf.replace(/_/g, '.') : qualifiedName;
}

export async function extractFieldValues(
  pdfDoc: any
): Promise<Record<string, string>> {
  return extractFieldValuesWithNameFn(pdfDoc, toQuikFieldName);
}

// Generic (non-Quik) generated PDFs are filled server-side with widget names
// equal to the raw servar/hidden-field key exactly (see the backend's
// `fill_pdf`/`transform_user_fill_data`), so field keys must be preserved
// as-is rather than run through Quik's underscore-to-dot leaf decoding
// (`toQuikFieldName` would otherwise corrupt a real key like `field_a` into
// `field.a`). Used by the generic Generate Documents review flow's
// `NativeFieldLayer.getEnvelopeOverrides`.
export async function extractRawFieldValues(
  pdfDoc: any
): Promise<Record<string, string>> {
  return extractFieldValuesWithNameFn(pdfDoc, (name) => name);
}

async function extractFieldValuesWithNameFn(
  pdfDoc: any,
  nameFn: (qualifiedName: string) => string
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
  Object.entries(fieldObjects).forEach(([qualifiedName, objs]) => {
    const name = nameFn(qualifiedName);
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
