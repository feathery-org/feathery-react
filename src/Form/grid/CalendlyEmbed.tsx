import React, { useEffect } from 'react';
import { dynamicImport } from '../../integrations/utils';
import {
  isCalendlyWindowEvent,
  transformCalendlyParams
} from '../../integrations/calendly';
import { featheryWindow } from '../../utils/browser';

export default function CalendlyEmbed({ form, successStep }: any) {
  useEffect(() => {
    // Script must be installed *after* Calendly div is rendered
    dynamicImport(
      'https://assets.calendly.com/assets/external/widget.js',
      true,
      true
    );

    const calendlyRedirect = (e: any) => {
      if (
        isCalendlyWindowEvent(e) &&
        e.data.event === 'calendly.event_scheduled'
      ) {
        if (successStep) {
          const nextStep: any = Object.values(form.steps).find(
            (step: any) => step.id === successStep
          );
          if (nextStep) form.changeStep(nextStep.key);
        }
      }
    };

    featheryWindow().addEventListener('message', calendlyRedirect);
    return () =>
      featheryWindow().removeEventListener('message', calendlyRedirect);
  }, []);

  let url = form.calendly.api_key;
  if (!url.endsWith('/')) url += '/';

  const params = transformCalendlyParams(form.calendly);
  if (params) {
    url += url.includes('?') ? '&' : '?';
    url += params;
  }

  return (
    <div
      key='calendly-component'
      className='calendly-inline-widget'
      data-url={url}
      style={{ width: '100%', height: '100%' }}
    />
  );
}
