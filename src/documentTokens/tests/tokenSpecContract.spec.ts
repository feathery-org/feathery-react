/**
 * The JavaScript half of the shared token-spec contract.
 *
 * The backend writes each token's spec into the document as `ftk:` + compact
 * JSON plus an `ftk_` bookmark (feathery-backend
 * apps/document/tests/test_token_spec_contract.py pins its side byte for
 * byte). This suite decodes those exact bytes: a renamed spec key or changed
 * separator over there would strand every token here, and these fixtures are
 * the only thing that makes that a failing test instead of a support ticket.
 */

import { bookmarkFor, decodeTag, encodeTag } from '../controls';
import { instanceKey, TokenSpec } from '../plan';
import tokenSpecCases from '../tokenSpecCases.json';

type Case = { why: string; spec: Record<string, unknown>; bookmark: string };
const CASES = tokenSpecCases.cases as Case[];

describe('token spec — shared contract', () => {
  it.each(CASES.map((c) => [c.why, c] as const))('%s', (_why, testCase) => {
    // The exact bytes wrap.py emits: compact JSON in fixture key order.
    // ASCII-only by fixture rule, so JSON.stringify matches json.dumps.
    const raw = 'ftk:' + JSON.stringify(testCase.spec);

    const decoded = decodeTag(raw);
    expect(decoded).toEqual(testCase.spec);
    expect(bookmarkFor(instanceKey(decoded as TokenSpec))).toBe(
      testCase.bookmark
    );
    // What this side re-encodes (a grown row's fresh tag) stays decodable.
    expect(decodeTag(encodeTag(decoded as TokenSpec))).toEqual(testCase.spec);
  });

  it('reads a fixture that is actually populated', () => {
    expect(CASES.length).toBeGreaterThanOrEqual(5);
    expect(CASES.some((c) => 'instance' in c.spec)).toBe(true);
    expect(CASES.some((c) => 'formula' in c.spec)).toBe(true);
  });
});
