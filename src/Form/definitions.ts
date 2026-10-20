export interface SharedCodeInfo {
  id: string;
  key: string;
  code: string;
  valid: boolean;
  created_at: string;
  updated_at: string;
}

export interface ExtractedExportVarInfo {
  name: string;
  value: any;
}

export interface ExtractedExportFuncInfo {
  name: string;
  signature: string;
  body: string;
  isAsync?: boolean;
}

export interface ExtractedSharedCodeInfo {
  key: string;
  exportVariables: ExtractedExportVarInfo[];
  exportFunctions: ExtractedExportFuncInfo[];
}
