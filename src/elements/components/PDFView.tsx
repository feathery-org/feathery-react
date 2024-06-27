import React from 'react';
import { fieldValues } from '../../utils/init';

export default function PdfView({ fieldKey }: any) {
  const [pdf, setPdf] = React.useState<any>(null);
  const fieldVal: any = fieldKey ? fieldValues[fieldKey] : null;

  React.useEffect(() => {
    if (fieldVal && fieldVal[0]) {
      const val = fieldVal[0];
      Promise.resolve(val).then((file: any) => {
        if (file && file.type === 'application/pdf') {
          setPdf(URL.createObjectURL(file));
        } else {
          setPdf(null);
        }
      });
    } else {
      setPdf(null);
    }
  }, [fieldVal]);

  if (!pdf) return null;
  return (
    <iframe
      width='100%'
      height='100%'
      src={pdf + '#view=FitH'}
      css={{ border: 'none' }}
    />
  );
}