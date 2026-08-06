/**
 * Seed document for development and tests: every block type, a field-backed
 * token, and a computed token, across two sections (= two pages).
 */
import { DocumentData, EMPTY_THEME } from './types';

export const SAMPLE_DOCUMENT: DocumentData = {
  theme: EMPTY_THEME,
  sections: [
    {
      id: 'sec_intro',
      blocks: [
        { id: 'blk_title', type: 'h1', content: [{ kind: 'text', text: 'Service Agreement' }] },
        {
          id: 'blk_intro',
          type: 'paragraph',
          content: [
            { kind: 'text', text: 'Prepared for ' },
            {
              kind: 'token',
              spec: {
                id: 'customer_name',
                source: 'customer_name',
                format: { kind: 'text' }
              }
            },
            { kind: 'text', text: '. All totals recalculate automatically.' }
          ]
        },
        { id: 'blk_scope_h', type: 'h2', content: [{ kind: 'text', text: 'Scope of Work' }] },
        { id: 'blk_scope_p', type: 'paragraph', content: [{ kind: 'text', text: 'The parties agree to the services below.' }] }
      ]
    },
    {
      id: 'sec_pricing',
      blocks: [
        { id: 'blk_pricing_h', type: 'h3', content: [{ kind: 'text', text: 'Pricing' }] },
        {
          id: 'blk_pricing_tbl',
          type: 'table',
          rows: [
            [
              { content: [{ kind: 'text', text: 'Item' }] },
              { content: [{ kind: 'text', text: 'Amount' }] }
            ],
            [
              { content: [{ kind: 'text', text: 'Design retainer' }] },
              {
                content: [
                  {
                    kind: 'token',
                    spec: {
                      id: 'retainer',
                      source: 'retainer',
                      format: { kind: 'currency', decimals: 2 }
                    }
                  }
                ]
              }
            ],
            [
              { content: [{ kind: 'text', text: 'Total (incl. 8% tax)' }] },
              {
                content: [
                  {
                    kind: 'token',
                    spec: {
                      id: 'total',
                      formula: 'ROUND(retainer * 1.08, 2)',
                      reads: ['retainer'],
                      format: { kind: 'currency', decimals: 2 }
                    }
                  }
                ]
              }
            ]
          ]
        }
      ]
    }
  ]
};
