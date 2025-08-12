import { Program } from 'acorn';

export interface ReusableLogicInfo {
  id: string;
  key: string;
  code: string;
  valid: boolean;
  created_at: string;
  updated_at: string;
}

export interface ExtractedExportVarInfo {
  name: string;
  value: string | number;
}

export interface ExtractedExportFuncInfo {
  name: string;
  signature: string;
  body: string;
}

export interface ExtractedReusableLogicInfo {
  key: string;
  exportVariables: ExtractedExportVarInfo[];
  exportFunctions: ExtractedExportFuncInfo[];
}

export interface ImportedSource {
  key: string;
  line: number;
  character: number;
}

export interface ImportedItem {
  key: string;
  itemName: string;
  line: number;
  character: number;
}

export interface ExtractedImportResult {
  importedSources: ImportedSource[];
  importedItems: ImportedItem[];
  parsedNodes: Program | null;
}
