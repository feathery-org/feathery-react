import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import DocumentViewer from '../../src/elements/components/DocumentViewer';

const harness = ((window as any).harness = {
  calls: [] as any[],
  completed: 0,
  closed: 0,
  settle: (_result: any) => {}
});

function Fixture() {
  const [show, setShow] = useState(true);
  const noPreset = (window as any).fixtureOptions?.noPreset;
  return show ? (
    <DocumentViewer
      payload={{
        expires_at: '2999-01-01T00:00:00Z',
        documents: ['Alpha', 'Beta'].map((name, i) => ({
          type: 'form' as const,
          name,
          pdf_url: `https://fixture.invalid/${i}.pdf`,
          envelope_id: `env-${i + 1}`,
          recipients: [{
            recipient_index: 0,
            name: i ? 'Sam' : 'Alex',
            email: i ? 'sam@example.com' : 'alex@example.com',
            routing_order: 1,
            role_labels: [i ? 'Witness' : 'Owner'],
            document_name: name
          }]
        }))
      }}
      action={{
        editor_toolbar_actions: ['sign', 'draft'],
        ...(noPreset ? {} : { email_subject: 'Please sign', email_blurb: 'Thanks' })
      }}
      setShow={(value) => { harness.closed++; setShow(value); }}
      onComplete={() => { harness.completed++; setShow(false); }}
      onFinalize={(params) => {
        harness.calls = [...harness.calls, params];
        return new Promise((resolve) => { harness.settle = resolve; });
      }}
    />
  ) : <p>Viewer closed</p>;
}

createRoot(document.getElementById('root')!).render(<Fixture />);
