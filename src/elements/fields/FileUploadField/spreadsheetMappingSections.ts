// Curated, sectioned list of fields collected via spreadsheet mapping. Each
// step in the mapping modal corresponds to one section. `key` is the field key
// values are written to (must match the form's hidden field keys); it is
// derived from the label but can be overridden if a form uses different keys.

export interface MappingFieldDef {
  key: string;
  label: string;
}

export interface MappingSection {
  title: string;
  fields: MappingFieldDef[];
}

const slug = (label: string): string =>
  label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');

const section = (title: string, labels: string[]): MappingSection => ({
  title,
  fields: labels.map((label) => ({ key: slug(label), label }))
});

export const SPREADSHEET_MAPPING_SECTIONS: MappingSection[] = [
  section('Client Information', [
    'First Name',
    'Middle Name',
    'Last Name',
    'SSN or Tax ID',
    'SSN or Tax ID Number',
    'Gender',
    'Date of Birth',
    'Marital Status',
    'Home Address Line 1',
    'Home Address Line 2',
    'Home Address State',
    'Home Address ZIP',
    'Home Address Country',
    'Mailing Address Line 1',
    'Mailing Address Line 2',
    'Mailing Address State',
    'Mailing Address ZIP',
    'Mailing Address Country',
    'Email Address',
    'Cell Phone',
    'Home Phone',
    'Employment Status',
    'Occupation',
    'Employer',
    'Citizenship Type',
    'Country of Citizenship'
  ]),
  section('Account Information', [
    'Owner First Name',
    'Owner Last Name',
    'Co-Owner First Name',
    'Co-Owner Last Name',
    'Delivering or Existing Account Number',
    'Delivering or Existing Firm Name',
    'Account Type',
    'Registration Type'
  ]),
  section('Beneficiary Information', [
    'Beneficiary Type',
    'Beneficiary Client Type',
    'Beneficiary Name',
    'Beneficiary DOB',
    'Beneficiary SSN',
    'Beneficiary Relationship',
    'Beneficiary Gender',
    'Beneficiary Allocation %',
    'Beneficiary Per Stirpes'
  ]),
  section('ACH and Distribution Information', [
    'Bank Type',
    'Bank Account Title',
    'ABA Number',
    'Bank Account Number',
    'Joint Bank Owner First Name',
    'Joint Bank Owner Last Name',
    'Joint Bank Owner Cell',
    'Standing ACH: Joint Bank Owner Email',
    'IRA Periodic Distribution: Type',
    'IRA Periodic Distribution: RMD',
    'IRA Periodic Distribution: Principal Amount',
    'Prior Year FMV for Periodic RMD',
    'IRA Periodic Distribution: Start Date',
    'IRA Periodic Distribution: Frequency',
    'IRA Periodic Distribution: Payment Method',
    'IRA Periodic Distribution: Federal Tax Withholding',
    'IRA Periodic Distribution: State Tax Withholding',
    'IRA Standing Taxes',
    'IRA Periodic Contribution Type',
    'IRA Periodic Contribution: Amount',
    'IRA Periodic Contribution: Frequency',
    'IRA Periodic Contribution: Date'
  ])
];
