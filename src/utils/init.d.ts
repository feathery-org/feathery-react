export function init(
  apiKey: string,
  options?: {
    userKey?: null | string;
    formKeys?: string[];
    tracking?: 'cookie' | 'fingerprint';
    authId?: string;
    authEmail?: string;
    authPhoneNumber?: string;
  }
  // not totally sure about this return type - <void> is the current implicit type
): Promise<void>;

export function updateUserKey(newUserKey: string, merge?: boolean): void;
export function setValues(userVals: FieldValues, rerender?: boolean): void;
export function validateStep(
  formKey: string,
  trigger?: boolean
): { [fieldKey: string]: errorMessage };
export function setAuthClient(authClient: any): void;
export function getAuthClient(): any;

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
