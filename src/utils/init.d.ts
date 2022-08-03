export type FeatheryFieldTypes =
  | null
  | boolean
  | string
  | string[]
  | number
  | number[]
  | Promise<File>
  | Promise<File>[];

export type FieldValues = {
  [fieldKey: string]: FeatheryFieldTypes;
};
export const fieldValues: FieldValues;
