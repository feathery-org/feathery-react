/**
 * A binding token in a header must become a binding, not stay text.
 *
 * `convertTokensOnOpen` walked `sections[].blocks` and stopped there, so a
 * template that puts `[[name=client.name]]` in its header rendered that token
 * to the client verbatim - the raw DSL, brackets and default value included,
 * printed at the top of every page of their deliverable.
 *
 * The damage is not only cosmetic. With no content control there is no binding
 * occurrence in the header, so nothing fans a new value into it, and
 * `assertNoHeaderOccurrence` - the guard that exists precisely to refuse this
 * situation - can never see a header to refuse, because for a token-authored
 * template there is none. A guard that cannot fire reads as protection while
 * protecting nothing.
 */
import { convertTemplateTokens } from '../templateImport';
import { scanBindings } from '../sfdtAdapter';

const para = (text: string) => ({ inlines: [{ text }] });

const templateWithHeaderToken = () => ({
  sections: [
    {
      blocks: [para('Prepared for [[name=client.name|default=Acme]].')],
      headersFooters: {
        header: { blocks: [para('Proposal for [[name=client.name|default=Acme]]')] },
        footer: { blocks: [para('Contact [[name=client.contact|default=Dana]]')] }
      }
    }
  ]
});

/**
 * Only what a reader would SEE. A converted control keeps the DSL in its `tag`,
 * which is correct and invisible; the defect is the tag language surviving as
 * rendered text.
 */
const visibleText = (node: any): string => {
  let out = '';
  const walk = (value: any, insideTag: boolean): void => {
    if (!value || typeof value !== 'object') return;
    if (Array.isArray(value)) return value.forEach((item) => walk(item, insideTag));
    for (const [key, child] of Object.entries(value)) {
      if (key === 'contentControlProperties' || key === 'ccp') continue;
      if (key === 'text' && typeof child === 'string') out += child;
      else walk(child, insideTag);
    }
  };
  walk(node, false);
  return out;
};

describe('template tokens in header and footer stories', () => {
  it('converts them instead of leaving the raw DSL on the page', () => {
    const out: any = convertTemplateTokens(templateWithHeaderToken() as any);
    // The client must never see the tag language itself.
    expect(visibleText(out.sfdt.sections[0].headersFooters)).not.toContain(
      '[[name='
    );
    expect(JSON.stringify(out.sfdt.sections[0].headersFooters)).toContain(
      'contentControlProperties'
    );
  });

  it('gives the header occurrence a binding identity the engine can see', () => {
    const out: any = convertTemplateTokens(templateWithHeaderToken() as any);
    const names = scanBindings(out.sfdt as any).occurrences.map(
      (occurrence: any) => occurrence.def.name
    );
    // Body and header share one identity; the footer carries its own.
    expect(names.filter((name: string) => name === 'client.name')).toHaveLength(
      2
    );
    expect(names).toContain('client.contact');
  });

  it('leaves a document with no header stories untouched', () => {
    const doc: any = {
      sections: [{ blocks: [para('Plain [[name=total|default=1]].')] }]
    };
    const out: any = convertTemplateTokens(doc as any);
    expect(visibleText(out.sfdt)).not.toContain('[[name=');
  });
});
