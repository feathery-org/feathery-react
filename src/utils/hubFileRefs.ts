import Field from './entities/Field';
import { FILE_FIELD_TYPES } from './fieldHelperFunctions';
import { fieldValues } from './init';

// A hub action file cell can name one of the form's file fields instead of
// carrying bytes: the backend files the copy it already holds.
export interface HubFileRef {
  form_field: string;
  indices?: number[];
}

interface FileServarStep {
  servar: { key: string; type: string; repeated?: boolean };
  stepKey: string;
}

export type FileSubmission = {
  servar: Record<string, any>;
  stepKey: string;
};

function fileServarSteps(steps: Record<string, any>) {
  const found: Record<string, FileServarStep> = {};
  Object.values(steps ?? {}).forEach((step: any) => {
    (step?.servar_fields ?? []).forEach(({ servar }: any) => {
      if (FILE_FIELD_TYPES.includes(servar.type) && !found[servar.key])
        found[servar.key] = { servar, stepKey: step.key };
    });
  });
  return found;
}

const asList = (value: any) => (Array.isArray(value) ? value : [value]);
const isFile = (value: any) =>
  value instanceof Promise || value instanceof Blob;

// Which file fields hold each element of `value`, by identity: a rule passes
// `field.value` or some of its entries, which are the stored promises/files.
function matchFieldFiles(value: any, fileKeys: string[]) {
  const items = asList(value);
  if (!items.length || !items.every(isFile)) return null;
  const matched: Record<string, number[]> = {};
  for (const item of items) {
    const key = fileKeys.find((k) => asList(fieldValues[k]).includes(item));
    if (!key) return null;
    const index = asList(fieldValues[key]).indexOf(item);
    (matched[key] = matched[key] ?? []).push(index);
  }
  return matched;
}

function toRefs(matched: Record<string, number[]>): HubFileRef[] {
  return Object.entries(matched).map(([key, indices]) => {
    const all = asList(fieldValues[key]).filter((v) => v !== null && v !== '');
    // Every file of the field is just the field; a subset names its rows.
    return indices.length === all.length
      ? { form_field: key }
      : {
          form_field: key,
          indices: [...new Set(indices)].sort((a, b) => a - b)
        };
  });
}

/**
 * Replace form file fields placed in a hub action's `data` with references,
 * and list the fields whose files must be on the server first. Values that
 * aren't a form file field are left as they are.
 */
export function buildHubFileRefs(
  data: Record<string, any> | Record<string, any>[] | undefined,
  steps: Record<string, any>
): { data: typeof data; submissions: FileSubmission[] } {
  if (!data || Array.isArray(data)) return { data, submissions: [] };
  const servarSteps = fileServarSteps(steps);
  const fileKeys = Object.keys(servarSteps);
  const referenced = new Set<string>();

  const converted: Record<string, any> = {};
  Object.entries(data).forEach(([column, value]) => {
    let refs: HubFileRef[] | null = null;
    if (value instanceof Field) {
      if (servarSteps[value.id]) refs = [{ form_field: value.id }];
    } else {
      const matched = matchFieldFiles(value, fileKeys);
      if (matched) refs = toRefs(matched);
    }
    if (!refs) {
      converted[column] = value;
      return;
    }
    refs.forEach((ref) => referenced.add(ref.form_field));
    converted[column] = refs;
  });

  const submissions = [...referenced]
    .filter((key) => fieldValues[key] !== null && fieldValues[key] !== '')
    .map((key) => {
      const { servar, stepKey } = servarSteps[key];
      return {
        servar: {
          key,
          [servar.type]: fieldValues[key],
          repeated: Boolean(servar.repeated)
        },
        stepKey
      };
    });
  return { data: converted, submissions };
}
