// Pure, servar-parameterized versions of the checks FileUploadField runs on
// a real drop/pick. Exported so formTools/validate.ts can run the identical
// checks against a tool-supplied file (see decodeAndValidateFiles) without
// duplicating - and risking drifting from - this logic.

export const DEFAULT_FILE_SIZE_LIMIT = 1024 * 1024 * 10;
export const NUM_FILES_LIMIT = 20;

// Custom file types are stored as bare extensions ("xlsx"), but legacy
// metadata may carry a leading dot (".xlsx"). Tolerate it so the token is
// ".xlsx" rather than "..xlsx", which no file would ever match.
export const customFileTypeToken = (customFileType: string): string =>
  `.${customFileType.trim().replace(/^\./, '')}`;

export const resolveAllowedFileTypes = (servar: any): string[] => {
  const allowedFileTypes: string[] = [...servar.metadata.file_types];
  if (servar.metadata.custom_file_types)
    allowedFileTypes.push(
      ...servar.metadata.custom_file_types.map(customFileTypeToken)
    );
  return allowedFileTypes;
};

const isFileTypeMatch = (file: File, allowedType: string) => {
  if (allowedType.endsWith('/*')) {
    const typeCategory = allowedType.split('/')[0];
    return file.type.startsWith(typeCategory + '/');
  }
  if (allowedType.includes('/')) return file.type === allowedType;
  const extension = '.' + file.name.split('.').pop()?.toLowerCase();
  return allowedType.toLowerCase() === extension;
};

export const validateFileTypes = (
  files: File[],
  allowedFileTypes: string[]
): void => {
  if (allowedFileTypes.length === 0) return;
  const individualTypes = allowedFileTypes.flatMap((str: string) =>
    str.split(',').map((item) => item.trim())
  );
  const invalidFiles = files.filter(
    (file) => !individualTypes.some((type) => isFileTypeMatch(file, type))
  );
  if (invalidFiles.length > 0)
    throw new Error(
      `Invalid file type. Allowed types: ${allowedFileTypes.join(', ')}`
    );
};

export const fileSizeLimitFor = (servar: any): number =>
  servar.max_length ? servar.max_length * 1024 : DEFAULT_FILE_SIZE_LIMIT;

export const validateFileSizes = (
  files: File[],
  fileSizeLimit: number
): void => {
  if (!files.some((file) => file.size > fileSizeLimit)) return;
  let sizeLabel = '';
  if (fileSizeLimit < 1024) sizeLabel = `${fileSizeLimit} bytes`;
  else if (fileSizeLimit <= 1024 * 1024)
    sizeLabel = `${Math.floor(fileSizeLimit / 1024)} kb`;
  else sizeLabel = `${Math.floor(fileSizeLimit / (1024 * 1024))} mb`;
  throw new Error(`File exceeds max size of ${sizeLabel}`);
};
