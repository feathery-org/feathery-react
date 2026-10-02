import React from 'react';
import type { Meta, StoryObj } from '@storybook/react-webpack5';
import type { BackendElement } from './backend/backendForm';
import { textRunCss, toStylesheet } from './backend/themeCss';
import { loadedBackendTheme } from './theme/storyHelpers';

// Plain HTML styled only by CSS generated from the backend theme's style keys,
// with no Feathery components involved. Shows what themeCss.ts produces and
// that it holds up outside the SDK. Needs the toolbar on a backend theme.

// Not `css`: emotion's JSX runtime claims that prop on every element
const Sheet = ({ sheet }: { sheet: string }) => (
  <style dangerouslySetInnerHTML={{ __html: sheet }} />
);

const sheetFor = (className: string, element?: BackendElement) =>
  element ? toStylesheet(className, element.styles, element.mobileStyles) : '';

function Sample({
  title,
  source,
  sheet,
  children
}: {
  title: string;
  source?: string;
  sheet: string;
  children: React.ReactNode;
}) {
  return (
    <section style={{ display: 'grid', gap: 8 }}>
      <h3 style={{ font: '600 13px/1.4 system-ui', margin: 0 }}>
        {title}
        <span style={{ fontWeight: 400, color: '#6B7280' }}>
          {source ? ` · from ${source}` : ' · not in this theme'}
        </span>
      </h3>
      <Sheet sheet={sheet} />
      <div style={{ width: 380 }}>{children}</div>
      <details>
        <summary style={{ font: '12px system-ui', cursor: 'pointer' }}>
          Generated CSS
        </summary>
        <pre
          style={{
            font: '11px/1.5 ui-monospace, monospace',
            whiteSpace: 'pre-wrap',
            background: '#F3F4F6',
            padding: 8,
            borderRadius: 4,
            maxWidth: 640
          }}
        >
          {sheet}
        </pre>
      </details>
    </section>
  );
}

const meta: Meta = {
  title: 'Theming/Theme CSS',
  render: (_args, context) => {
    const theme = loadedBackendTheme(context);
    if (!theme) {
      return (
        <p style={{ font: '14px system-ui' }}>
          Switch the Theme toolbar to a <strong>backend</strong> theme to map it
          from the API onto plain HTML.
        </p>
      );
    }

    const { button, heading, body, progressBar, fields, elements } = theme;
    const textField = fields.text_field ?? fields.email;
    const { checkbox } = fields;
    const { tab, table } = elements;

    return (
      <div style={{ display: 'grid', gap: 32 }}>
        <Sample
          title='Heading and body text'
          source={[heading?.source, body?.source].filter(Boolean).join(', ')}
          sheet={sheetFor('t-heading', heading) + sheetFor('t-body', body)}
        >
          <div className='t-heading-container'>
            <h1 className='t-heading' style={{ margin: 0 }}>
              <span style={textRunCss(heading?.textAttributes)}>
                Create your account
              </span>
            </h1>
          </div>
          <div className='t-body-container'>
            <p className='t-body' style={{ margin: 0 }}>
              It only takes a minute. You can change these details later.
            </p>
          </div>
        </Sample>

        <Sample
          title='Text field'
          source={textField?.source}
          sheet={sheetFor('t-input', textField)}
        >
          <label className='t-input-label' htmlFor='t-input'>
            Work email
          </label>
          <div className='t-input-container'>
            <input
              id='t-input'
              className='t-input'
              placeholder='jane@company.com'
              style={{ outline: 'none', padding: '0 12px' }}
            />
          </div>
        </Sample>

        <Sample
          title='Checkbox'
          source={checkbox?.source}
          sheet={sheetFor('t-check', checkbox)}
        >
          <label
            className='t-check-label'
            style={{ display: 'flex', alignItems: 'center', gap: 8 }}
          >
            <input
              type='checkbox'
              className='t-check'
              defaultChecked
              style={{ appearance: 'none', margin: 0, flexShrink: 0 }}
            />
            Send me product updates
          </label>
        </Sample>

        <Sample
          title='Button'
          source={button?.source}
          sheet={sheetFor('t-button', button)}
        >
          <div className='t-button-container'>
            <button className='t-button' style={{ cursor: 'pointer' }}>
              <span style={textRunCss(button?.textAttributes)}>Continue</span>
            </button>
          </div>
          <div className='t-button-container'>
            <button className='t-button' disabled>
              Disabled
            </button>
          </div>
        </Sample>

        <Sample
          title='Progress bar'
          source={progressBar?.source}
          sheet={sheetFor('t-progress', progressBar)}
        >
          <div className='t-progress-container'>
            <div className='t-progress' style={{ overflow: 'hidden' }}>
              <div
                className='t-progress-bar'
                style={{ width: '40%', height: '100%' }}
              />
            </div>
          </div>
        </Sample>

        <Sample
          title='Tabs'
          source={tab?.source}
          sheet={sheetFor('t-tab', tab)}
        >
          <div style={{ display: 'flex' }}>
            {['Overview', 'Details', 'History'].map((label, i) => (
              <button
                key={label}
                className='t-tab'
                aria-selected={i === 0}
                style={{ width: 'auto', flex: 1, cursor: 'pointer' }}
              >
                {label}
              </button>
            ))}
          </div>
        </Sample>

        <Sample
          title='Table'
          source={table?.source}
          sheet={sheetFor('t-table', table)}
        >
          <table
            className='t-table'
            style={{ borderCollapse: 'separate', borderSpacing: 0 }}
          >
            <thead>
              <tr>
                {['Name', 'Role', 'Status'].map((h) => (
                  <th key={h} style={{ textAlign: 'left', padding: 8 }}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {[
                ['Ada Lovelace', 'Engineer', 'Active'],
                ['Alan Turing', 'Researcher', 'Invited']
              ].map((row) => (
                <tr key={row[0]}>
                  {row.map((cell) => (
                    <td key={cell} style={{ padding: 8 }}>
                      {cell}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </Sample>
      </div>
    );
  }
};

export default meta;

export const PlainHtml: StoryObj = {};
