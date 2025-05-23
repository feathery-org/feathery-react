export const countryMaxLengthMap: Record<string, number> = {
  // India (+91) numbers are 10-digits except for machine to machine communication
  IN: 2 + 10,
  // Singapore (+65) numbers are 8-digits except for special service numbers
  SG: 2 + 8
};

export function isValidPhoneLength(
  phoneNumber: string, // includes country code digits
  countryCode: string
): boolean {
  // country not in override mapping
  if (!(countryCode in countryMaxLengthMap)) return true;
  if (phoneNumber.length > countryMaxLengthMap[countryCode]) return false;
  return true;
}
