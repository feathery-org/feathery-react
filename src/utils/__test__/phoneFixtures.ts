// Explicit expected international values; formatting variants do not use the parser.
export const phoneFixtures = [
  {
    country: 'US',
    national: '2025550123',
    formatted: '(202) 555-0123',
    canonical: '12025550123'
  },
  {
    country: 'CA',
    national: '4165550123',
    formatted: '(416) 555-0123',
    canonical: '14165550123'
  },
  {
    country: 'GB',
    national: '02079460018',
    formatted: '020 7946 0018',
    canonical: '442079460018'
  },
  {
    country: 'FR',
    national: '0612345678',
    formatted: '06 12 34 56 78',
    canonical: '33612345678'
  },
  {
    country: 'DE',
    national: '015123456789',
    formatted: '01512 3456789',
    canonical: '4915123456789'
  },
  {
    country: 'IN',
    national: '09876543210',
    formatted: '098765 43210',
    canonical: '919876543210'
  },
  {
    country: 'SG',
    national: '81234567',
    formatted: '8123 4567',
    canonical: '6581234567'
  },
  {
    country: 'AU',
    national: '0412345678',
    formatted: '0412 345 678',
    canonical: '61412345678'
  },
  {
    country: 'NZ',
    national: '0212345678',
    formatted: '021 234 5678',
    canonical: '64212345678'
  },
  {
    country: 'IT',
    national: '0212345678',
    formatted: '02 1234 5678',
    canonical: '390212345678'
  },
  {
    country: 'BR',
    national: '11961234567',
    formatted: '(11) 96123-4567',
    canonical: '5511961234567'
  },
  {
    country: 'JP',
    national: '09012345678',
    formatted: '090-1234-5678',
    canonical: '819012345678'
  },
  {
    country: 'MX',
    national: '5512345678',
    formatted: '55 1234 5678',
    canonical: '525512345678'
  },
  {
    country: 'AG',
    national: '2684641234',
    formatted: '(268) 464-1234',
    canonical: '12684641234'
  }
];

export const formatPhoneDigits = (value: string, separator: string) =>
  value.replace(/(\d{3})(?=\d)/g, `$1${separator}`);
