import { downloadBaseName } from './downloadFileName';

describe('downloadBaseName', () => {
  it.each([
    [
      'encoded spaces in a presigned URL',
      'https://bucket.s3.amazonaws.com/envelopes/abc/DIAMOND%20LAKE%20YACHT%20CLUB_Management_Liability_Comparison_Proposal.docx?X-Amz-Signature=x&X-Amz-Expires=3600',
      'DIAMOND LAKE YACHT CLUB_Management_Liability_Comparison_Proposal'
    ],
    [
      'a plain name',
      'https://bucket.s3.amazonaws.com/envelopes/abc/Proposal.pdf',
      'Proposal'
    ],
    [
      'characters browsers reject',
      'https://x.test/a/Acme%3A%20%22Q1%22%2FQ2%3F.docx',
      'Acme_ _Q1__Q2_'
    ],
    ['a missing file', null, 'document'],
    ['an empty file', '', 'document'],
    [
      'malformed percent-encoding',
      'https://x.test/a/Bad%E0%A4%A.docx',
      'document'
    ],
    ['a name that is only an extension', 'https://x.test/a/.docx', 'document']
  ])('handles %s', (_, url, expected) => {
    expect(downloadBaseName(url)).toBe(expected);
  });
});
