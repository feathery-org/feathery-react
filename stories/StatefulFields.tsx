import React, { useEffect, useState } from 'react';
import Elements from '../src/elements';
import { fieldValues } from '../src/utils/init';

// TextField reads its value from the form's global field values rather than a
// prop, so this stands in for the form: it owns the value and writes it where
// the field looks before each render.
export function StatefulTextField({ element, disabled, editMode }: any) {
  const key = element.servar.key;
  const [value, setValue] = useState<any>(fieldValues[key] ?? '');
  fieldValues[key] = value;
  return (
    <Elements.TextField
      element={element}
      disabled={disabled}
      editMode={editMode}
      required={element.servar.required}
      onAccept={(v: any) => setValue(v)}
      // Changes identity with the value, so the memoized element re-renders
      value={value}
    />
  );
}

export function StatefulCheckbox({ element, checked, disabled }: any) {
  const [value, setValue] = useState(checked);
  // Let the control drive the value as well as clicks
  useEffect(() => setValue(checked), [checked]);
  return (
    <Elements.CheckboxField
      element={element}
      fieldVal={value}
      disabled={disabled}
      onChange={(e: any) => setValue(e.target.checked)}
    />
  );
}
