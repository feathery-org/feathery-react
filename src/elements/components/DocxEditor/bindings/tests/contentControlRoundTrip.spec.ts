// Spike S1 (blocking): can a `[[...]]` binding tag ride inside a content
// control across every boundary the port depends on?
//
// Three boundaries, in the order the product crosses them:
//   1. serialize()  - the reconcile loop reads the tag back on every commit;
//   2. saveAsBlob('Docx') - the tag has to persist as a Word SDT, because
//      feathery-react saves envelopes as .docx, never as SFDT;
//   3. .docx -> SFDT through the gated backend proxy (Feathery's Word Processor
//      service) - the only leg that cannot be proven offline, so it is written
//      here and skipped unless a service URL is supplied.
//
// If (1) or (2) fails, the tag-in-content-control representation cannot carry
// bindings and the port needs a different anchor before any code is written.
import JSZip from 'jszip';
import {
  cellTagged,
  cellText,
  collectTags,
  destroyRealDocumentEditor,
  docWith,
  isOptimizedSfdt,
  makeRealDocumentEditor,
  para,
  row,
  table,
  taggedInline,
  textRun
} from './realEditorHarness';

const FIELD_TAG = '[[name=project.name]]';
const TYPED_TAG = '[[name=tax_rate|type=percent|del=keep]]';
const FORMULA_TAG = '[[name=line_total|expr=mul(quantity,unit_cost)|row=r-1]]';
const ROW_TAG = '[[name=quantity|type=integer|row=r-1]]';

/** The costs-style document the POC reconciles: prose field + a bound table. */
const boundDocument = () =>
  docWith(
    para(textRun('Estimate for '), taggedInline(FIELD_TAG, 'Acme')),
    para(textRun('Tax rate: '), taggedInline(TYPED_TAG, '8.5%')),
    table(
      row(cellText('Item'), cellText('Qty'), cellText('Line total')),
      row(
        cellText('Widget'),
        cellTagged(ROW_TAG, '3'),
        cellTagged(FORMULA_TAG, '$30.00')
      )
    )
  );

async function blobToArrayBuffer(blob: Blob): Promise<ArrayBuffer> {
  if (typeof (blob as any).arrayBuffer === 'function') {
    return (blob as any).arrayBuffer();
  }
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as ArrayBuffer);
    reader.onerror = () => reject(reader.error);
    reader.readAsArrayBuffer(blob);
  });
}

describe('S1 content control tags survive serialize()', () => {
  it('keeps every tag verbatim when optimizeSfdt is off', () => {
    const editor = makeRealDocumentEditor(boundDocument(), {
      optimizeSfdt: false
    });
    try {
      const serialized = editor.serialize();
      expect(isOptimizedSfdt(serialized)).toBe(false);

      const tags = collectTags(JSON.parse(serialized));
      // Syncfusion emits a start and an end content control per binding, so a
      // tag can legitimately appear more than once; identity is what matters.
      expect(new Set(tags)).toEqual(
        new Set([FIELD_TAG, TYPED_TAG, ROW_TAG, FORMULA_TAG])
      );
    } finally {
      destroyRealDocumentEditor(editor);
    }
  });

  it('exposes tags under the full `contentControlProperties` keyword the adapter reads', () => {
    const editor = makeRealDocumentEditor(boundDocument(), {
      optimizeSfdt: false
    });
    try {
      const parsed = JSON.parse(editor.serialize());
      const firstParagraph = parsed.sections[0].blocks[0];
      const control = firstParagraph.inlines.find(
        (inline: any) => inline.contentControlProperties
      );
      expect(control).toBeDefined();
      expect(control.contentControlProperties.tag).toBe(FIELD_TAG);
    } finally {
      destroyRealDocumentEditor(editor);
    }
  });

  // The porting constraint this spike exists to pin. Syncfusion defaults
  // optimizeSfdt to TRUE and feathery-react never sets it, so a
  // straight port of the POC adapter - which walks
  // `sections[].blocks[].inlines[].contentControlProperties` - would read every
  // real document as having zero bindings. Minification is not lossy: the tag
  // is intact, it just moves to `ccp`/`tg`. So the port has two valid fixes
  // (construct with optimizeSfdt: false, or teach the adapter both keyword
  // sets) and this test is what makes the choice explicit rather than lucky.
  it('shows the default optimizeSfdt=true hides tags from the full-keyword read path', () => {
    const editor = makeRealDocumentEditor(boundDocument(), {
      optimizeSfdt: true
    });
    try {
      const serialized = editor.serialize();
      expect(isOptimizedSfdt(serialized)).toBe(true);

      // The adapter's read path is gone...
      expect(serialized).not.toContain('"contentControlProperties"');
      expect(serialized).toContain('"ccp"');

      // ...but nothing was lost: the tag is reachable under the short keywords.
      const tags = new Set(collectTags(JSON.parse(serialized)));
      expect(tags).toEqual(
        new Set([FIELD_TAG, TYPED_TAG, ROW_TAG, FORMULA_TAG])
      );
    } finally {
      destroyRealDocumentEditor(editor);
    }
  });

  it('preserves DSL punctuation and a long tag without truncation', () => {
    const longName = 'a'.repeat(200);
    const punctuated = '[[name=a.b_c|type=currency:USD:2|default=%7C%3D%25]]';
    const long = `[[name=${longName}|type=text]]`;
    const editor = makeRealDocumentEditor(
      docWith(
        para(taggedInline(punctuated, 'x')),
        para(taggedInline(long, 'y'))
      ),
      { optimizeSfdt: false }
    );
    try {
      const tags = new Set(collectTags(JSON.parse(editor.serialize())));
      expect(tags.has(punctuated)).toBe(true);
      expect(tags.has(long)).toBe(true);
    } finally {
      destroyRealDocumentEditor(editor);
    }
  });
});

describe('S1 content control tags survive DOCX export', () => {
  it('writes each tag into word/document.xml as an SDT tag', async () => {
    const editor = makeRealDocumentEditor(boundDocument(), {
      optimizeSfdt: false
    });
    try {
      const blob = await editor.saveAsBlob('Docx');
      const zip = await JSZip.loadAsync(await blobToArrayBuffer(blob));
      const documentXml = await zip.file('word/document.xml')!.async('string');

      expect(documentXml).toContain('<w:sdt>');
      for (const tag of [FIELD_TAG, TYPED_TAG, ROW_TAG, FORMULA_TAG]) {
        // Word escapes nothing in these tags, so an exact substring match also
        // proves no truncation and no re-encoding of `|` or `=`.
        expect(documentXml).toContain(tag);
      }
    } finally {
      destroyRealDocumentEditor(editor);
    }
  });

  it('keeps the locked formula control locked through export', async () => {
    const editor = makeRealDocumentEditor(
      docWith(para(taggedInline(FORMULA_TAG, '$30.00', { lockContents: true }))),
      { optimizeSfdt: false }
    );
    try {
      const blob = await editor.saveAsBlob('Docx');
      const zip = await JSZip.loadAsync(await blobToArrayBuffer(blob));
      const documentXml = await zip.file('word/document.xml')!.async('string');
      expect(documentXml).toContain(FORMULA_TAG);
      expect(documentXml).toMatch(/<w:lock[^>]*w:val="[^"]*[Cc]ontent/);
    } finally {
      destroyRealDocumentEditor(editor);
    }
  });
});

// The one leg that needs the gated backend. feathery-react converts .docx via
// `${serviceUrl}Import` behind Feathery's own proxy (default
// `${API_URL}document/editor/`), so this runs only when a reachable service is
// supplied:
//   FEATHERY_DOCX_SERVICE_URL=http://localhost:8000/api/document/editor/ \
//   FEATHERY_SDK_TOKEN=<token> yarn test contentControlRoundTrip
const SERVICE_URL = process.env.FEATHERY_DOCX_SERVICE_URL;
const serviceIt = SERVICE_URL ? it : it.skip;

describe('S1 tags survive .docx -> SFDT through the gated proxy', () => {
  serviceIt(
    'returns content control tags from the Import endpoint',
    async () => {
      const editor = makeRealDocumentEditor(boundDocument(), {
        optimizeSfdt: false
      });
      let docx: Blob;
      try {
        docx = await editor.saveAsBlob('Docx');
      } finally {
        destroyRealDocumentEditor(editor);
      }

      const form = new FormData();
      form.append('files', docx, 'bound.docx');
      const token = process.env.FEATHERY_SDK_TOKEN;
      const response = await fetch(`${SERVICE_URL}Import`, {
        method: 'POST',
        body: form,
        headers: token ? { Authorization: `Token ${token}` } : undefined
      });
      expect(response.ok).toBe(true);

      const sfdt = await response.text();
      const tags = new Set(collectTags(JSON.parse(sfdt)));
      expect(tags.has(FIELD_TAG)).toBe(true);
      expect(tags.has(FORMULA_TAG)).toBe(true);
    },
    30000
  );
});
