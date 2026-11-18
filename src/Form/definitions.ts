export interface SharedCodeInfo {
  id: string;
  key: string;
  code: string;
  valid: boolean;
  created_at: string;
  updated_at: string;
}

// A top-level declaration in shared code, which an inlined export may need
export interface SharedCodeDeclaration {
  name: string;
  // The declaration as the rule re-declares it
  code: string;
  isFunction: boolean;
  // Every name it reads, including inside nested functions
  referencedNames: string[];
  // Names a variable's initializer reads while it is evaluated
  evaluatedNames: string[];
  // Whether evaluating a variable's initializer awaits
  awaits: boolean;
}

export interface ExtractedExportVarInfo {
  name: string;
  // The static value, or the initializer's source when it is computed
  value: any;
  // Whether the initializer is not a static value and so runs in the rule
  isComputed?: boolean;
}

export interface ExtractedExportFuncInfo {
  name: string;
  signature: string;
  body: string;
  isAsync?: boolean;
  // Module names the body reads that it does not declare itself
  referencedNames: string[];
  // Its parameters and body-level declarations
  ownNames: string[];
}

export interface ExtractedSharedCodeInfo {
  key: string;
  // Every top-level declaration in source order
  declarations: SharedCodeDeclaration[];
  exportVariables: ExtractedExportVarInfo[];
  exportFunctions: ExtractedExportFuncInfo[];
}
