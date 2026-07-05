import { FieldLayer, QuikFieldOverride, ValidationIssue } from './types';
import { extractFieldValues, toFormFields } from './serialize';
import { ViewerDocument } from '../index';

const REQUIRED_FIELD_FLAG = 2;

export type LoadedDoc = { doc: ViewerDocument; pdfProxy: any };

export class NativeFieldLayer implements FieldLayer {
  private getDocs: () => LoadedDoc[];

  private remount: () => void;

  constructor(getDocs: () => LoadedDoc[], remount: () => void) {
    this.getDocs = getDocs;
    this.remount = remount;
  }

  async getOverrides(): Promise<QuikFieldOverride[]> {
    const overrides: QuikFieldOverride[] = [];
    for (const { doc, pdfProxy } of this.getDocs()) {
      if (doc.type !== 'form' || !pdfProxy) continue;
      const values = await extractFieldValues(pdfProxy);
      overrides.push({
        form_id: doc.form_id ?? '',
        group_index: doc.group_index ?? 0,
        form_fields: toFormFields(values)
      });
    }
    return overrides;
  }

  reset(): void {
    this.remount();
  }

  async validate(): Promise<ValidationIssue[]> {
    const issues: ValidationIssue[] = [];
    const docs = this.getDocs();
    for (let docIndex = 0; docIndex < docs.length; docIndex++) {
      const { doc, pdfProxy } = docs[docIndex];
      if (doc.type !== 'form' || !pdfProxy) continue;
      const values = await extractFieldValues(pdfProxy);
      for (let p = 1; p <= (pdfProxy.numPages ?? 0); p++) {
        const page = await pdfProxy.getPage(p);
        const annotations = await page.getAnnotations();
        for (const ann of annotations) {
          if (
            ann.fieldName &&
            // eslint-disable-next-line no-bitwise
            (ann.fieldFlags & REQUIRED_FIELD_FLAG) !== 0 &&
            !values[ann.fieldName]
          ) {
            issues.push({ docIndex, fieldName: ann.fieldName });
          }
        }
      }
    }
    return issues;
  }
}
