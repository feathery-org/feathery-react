import { envelopeDownloadName } from './downloadFileName';

describe('envelopeDownloadName', () => {
  it.each([
    [
      'encoded spaces in a presigned URL',
      'https://bucket.s3.amazonaws.com/envelopes/abc/DIAMOND%20LAKE%20YACHT%20CLUB_Management_Liability_Comparison_Proposal.docx?X-Amz-Signature=x&X-Amz-Expires=3600',
      'DIAMOND LAKE YACHT CLUB_Management_Liability_Comparison_Proposal'
    ],
    [
      'a dotted name',
      'https://x.test/a/Acme%20Inc.%20Proposal.pdf',
      'Acme Inc. Proposal'
    ],
    ['malformed percent-encoding', 'https://x.test/a/Bad%E7.docx', 'Bad%E7'],
    ['a missing file', null, 'document'],
    ['an extension-only name', 'https://x.test/a/.docx', 'document']
  ])('handles %s', (_, url, expected) => {
    expect(envelopeDownloadName(url)).toBe(expected);
  });
});
