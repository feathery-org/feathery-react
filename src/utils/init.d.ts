export function init(
  apiKey: string,
  options?: {
    userKey?: null | string;
    formKeys?: string[];
    tracking?: 'cookie' | 'fingerprint' | '';
    authId?: string;
    authEmail?: string;
    authPhoneNumber?: string;
  }
): Promise<void>;

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

export function updateUserKey(newUserKey: string, merge?: boolean): void;
export function setValues(userVals: FieldValues, rerender?: boolean): void;
export function validateStep(
  formKey: string,
  trigger?: boolean
): { [fieldKey: string]: string };
export function setAuthClient(authClient: any): void;
export function getAuthClient(): any;
