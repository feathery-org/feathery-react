import React, { useEffect, useId, useRef, useState } from 'react';
import { primaryButtonCss, secondaryButtonCss } from './buttonStyles';
import { color, fontSize, radius, shadow } from './tokens';
import { trapTabKey } from './keyboard';

export interface SigningRecipient {
  envelope_id: string;
  recipient_index: number;
  name: string;
  email: string;
  routing_order: number;
  role_labels: string[];
  is_self?: boolean;
  document_name?: string;
}

export interface SigningOptions {
  recipients: SigningRecipient[];
  email_subject: string;
  email_blurb: string;
}

export interface SigningOptionsModalProps {
  initialValues: SigningOptions;
  draft?: boolean;
  busy: boolean;
  error?: string;
  onClose: () => void;
  onSubmit: (values: SigningOptions) => void;
}

const inputCss = {
  width: '100%',
  boxSizing: 'border-box',
  padding: '9px 10px',
  border: `1px solid ${color.border}`,
  borderRadius: radius.sm,
  font: 'inherit',
  color: color.text,
  backgroundColor: color.surface,
  '&:focus-visible': { outline: `2px solid ${color.accent}`, outlineOffset: 2 }
} as const;
const labelCss = { display: 'grid', gap: 6 } as const;

export default function SigningOptionsModal({
  initialValues,
  draft = false,
  busy,
  error,
  onClose,
  onSubmit
}: SigningOptionsModalProps) {
  const [values, setValues] = useState(() => ({
    ...initialValues,
    recipients: initialValues.recipients.map((row) => ({ ...row }))
  }));
  const [orders, setOrders] = useState(() =>
    initialValues.recipients.map((row) => String(row.routing_order))
  );
  const [step, setStep] = useState(1);
  const [validationError, setValidationError] = useState('');
  const dialogRef = useRef<HTMLDivElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const titleId = useId();
  const errorId = useId();

  useEffect(() => {
    const previous = dialogRef.current?.ownerDocument
      .activeElement as HTMLElement | null;
    headingRef.current?.focus();
    return () => {
      previous?.focus();
    };
  }, []);

  useEffect(() => {
    headingRef.current?.focus();
  }, [step]);

  const updateRecipient = (
    index: number,
    field: 'name' | 'email',
    value: string
  ) => {
    setValues((previous) => ({
      ...previous,
      recipients: previous.recipients.map((row, i) =>
        i === index ? { ...row, [field]: value } : row
      )
    }));
  };

  const validateRecipients = () => {
    if (!values.recipients.length)
      return 'No signers are configured for these documents. Close this dialog and update the signer configuration.';
    for (const [index, row] of values.recipients.entries()) {
      const order = Number(orders[index]);
      if (!Number.isSafeInteger(order) || order < 1)
        return 'Signing order must be a positive integer.';
      const inPerson = row.is_self && !row.email.trim();
      if (!inPerson && !row.name.trim())
        return `Enter a name for recipient ${index + 1}.`;
      if (!inPerson && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(row.email.trim()))
        return `Enter a valid email for recipient ${index + 1}.`;
    }
    return '';
  };

  const advance = () => {
    if (busy) return;
    const problem = validateRecipients();
    setValidationError(problem);
    if (!problem) setStep(2);
  };

  const submit = () => {
    if (busy) return;
    const problem =
      validateRecipients() ||
      (values.email_subject.length > 256
        ? 'Subject must be 256 characters or fewer.'
        : '') ||
      (values.email_blurb.length > 10000
        ? 'Message must be 10000 characters or fewer.'
        : '');
    setValidationError(problem);
    if (problem) return;
    onSubmit({
      ...values,
      recipients: values.recipients.map((row, index) => ({
        ...row,
        name: row.name.trim(),
        email: row.email.trim(),
        routing_order: Number(orders[index])
      }))
    });
  };

  const shownError = validationError || error;
  const multipleDocuments =
    new Set(values.recipients.map((row) => row.envelope_id)).size > 1;

  return (
    <div
      css={{
        position: 'absolute',
        inset: 0,
        zIndex: 110,
        backgroundColor: 'rgba(17,24,39,0.4)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 16
      }}
    >
      <div
        ref={dialogRef}
        role='dialog'
        aria-modal='true'
        aria-labelledby={titleId}
        aria-describedby={shownError ? errorId : undefined}
        aria-busy={busy}
        tabIndex={-1}
        onKeyDown={(event) => {
          event.stopPropagation();
          if (event.key === 'Escape') {
            event.preventDefault();
            if (!busy) onClose();
          } else if (event.key === 'Tab' && dialogRef.current) {
            if (busy) {
              event.preventDefault();
              dialogRef.current.focus();
            } else trapTabKey(dialogRef.current, event);
          }
        }}
        css={{
          width: '100%',
          maxWidth: 680,
          maxHeight: '100%',
          overflow: 'auto',
          padding: 24,
          boxSizing: 'border-box',
          backgroundColor: color.surface,
          borderRadius: radius.md,
          boxShadow: shadow.menu,
          color: color.text,
          fontSize: fontSize.base
        }}
      >
        <div
          css={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            gap: 16
          }}
        >
          <h2
            id={titleId}
            ref={headingRef}
            tabIndex={-1}
            css={{ fontSize: 20, margin: 0 }}
          >
            {step === 1 ? 'Configure signers' : 'Customize email'}
          </h2>
          <button
            type='button'
            css={secondaryButtonCss}
            disabled={busy}
            aria-label='Close signing options'
            onClick={onClose}
          >
            Close
          </button>
        </div>
        <p css={{ color: color.textMuted }}>Step {step} of 2</p>
        {step === 1 ? (
          <>
            <p>Recipients with the same signing order sign in parallel.</p>
            {values.recipients.map((row, index) => (
              <fieldset
                key={`${row.envelope_id}:${row.recipient_index}`}
                disabled={busy}
                css={{
                  border: `1px solid ${color.border}`,
                  borderRadius: radius.md,
                  padding: 16,
                  margin: '16px 0',
                  minWidth: 0
                }}
              >
                <legend>
                  {row.role_labels.join(', ') || `Recipient ${index + 1}`}
                </legend>
                {multipleDocuments && row.document_name && (
                  <p css={{ marginTop: 0, color: color.textMuted }}>
                    {row.document_name}
                  </p>
                )}
                {row.is_self && <p>You</p>}
                <div
                  css={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
                    gap: 12
                  }}
                >
                  <label css={labelCss}>
                    Name
                    <input
                      aria-label={`Name ${index + 1}`}
                      css={inputCss}
                      value={row.name}
                      onChange={(event) =>
                        updateRecipient(index, 'name', event.target.value)
                      }
                    />
                  </label>
                  <label css={labelCss}>
                    Email
                    <input
                      aria-label={`Email ${index + 1}`}
                      disabled={row.is_self}
                      type='email'
                      css={inputCss}
                      value={row.email}
                      onChange={(event) =>
                        updateRecipient(index, 'email', event.target.value)
                      }
                    />
                  </label>
                  <label css={labelCss}>
                    Signing order
                    <input
                      aria-label={`Signing order ${index + 1}`}
                      type='number'
                      min={1}
                      step={1}
                      css={inputCss}
                      value={orders[index]}
                      onChange={(event) => {
                        const next = event.target.value;
                        setOrders((previous) =>
                          previous.map((order, i) =>
                            i === index ? next : order
                          )
                        );
                      }}
                    />
                  </label>
                </div>
              </fieldset>
            ))}
          </>
        ) : (
          <div css={{ display: 'grid', gap: 16 }}>
            <label css={labelCss}>
              Subject
              <input
                disabled={busy}
                css={inputCss}
                maxLength={256}
                placeholder='Use default subject'
                value={values.email_subject}
                onChange={(event) =>
                  setValues({ ...values, email_subject: event.target.value })
                }
              />
            </label>
            <label css={labelCss}>
              Message
              <textarea
                disabled={busy}
                css={inputCss}
                rows={6}
                maxLength={10000}
                placeholder='Add a message to the signing invitation'
                value={values.email_blurb}
                onChange={(event) =>
                  setValues({ ...values, email_blurb: event.target.value })
                }
              />
            </label>
          </div>
        )}
        {shownError && (
          <p
            id={errorId}
            role='alert'
            css={{
              color: color.errorText,
              backgroundColor: color.errorBg,
              padding: 12,
              borderRadius: radius.sm
            }}
          >
            {shownError}
          </p>
        )}
        {busy && <p role='status'>{draft ? 'Creating draft…' : 'Sending…'}</p>}
        <div
          css={{
            display: 'flex',
            justifyContent: 'flex-end',
            gap: 12,
            marginTop: 24
          }}
        >
          {step === 2 && (
            <button
              type='button'
              disabled={busy}
              css={secondaryButtonCss}
              onClick={() => {
                setValidationError('');
                setStep(1);
              }}
            >
              Back
            </button>
          )}
          <button
            type='button'
            disabled={busy}
            css={primaryButtonCss}
            onClick={step === 1 ? advance : submit}
          >
            {step === 1 ? 'Next' : draft ? 'Create Draft' : 'Send'}
          </button>
        </div>
      </div>
    </div>
  );
}
