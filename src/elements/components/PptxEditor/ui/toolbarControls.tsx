import React, { useEffect, useRef } from 'react';
import { featheryWindow } from '../../../../utils/browser';
import { ZINC } from '../../DocxEditor/DocxToolbar/styles';
import { styles } from './toolbarStyles';

export function B(props: {
  on?: boolean;
  disabled?: boolean;
  onClick: () => void;
  children: React.ReactNode;
  title?: string;
  historyAction?: boolean;
}) {
  return (
    <button
      // The editor can sit inside the hosted form's <form>; an untyped button
      // defaults to type=submit and reloads the page.
      type='button'
      title={props.title}
      aria-label={props.title}
      aria-pressed={props.on === undefined ? undefined : props.on}
      disabled={props.disabled}
      onClick={props.onClick}
      // Word-style: toolbar clicks never take focus, so the page cannot
      // scroll-to-focus and the stage's text selection survives.
      onMouseDown={(e) => e.preventDefault()}
      data-history-action={props.historyAction ? '' : undefined}
      css={styles.btn(props.on, props.disabled)}
    >
      {props.children}
    </button>
  );
}

export function ColorControl(props: {
  disabled?: boolean;
  value: string;
  onCommit: (value: string) => void;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <span
      css={{
        ...styles.btn(false, props.disabled),
        position: 'relative',
        flexDirection: 'column',
        gap: 1,
        padding: '2px 7px 3px'
      }}
      aria-label={props.title}
    >
      <span
        css={{
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: 12.5,
          fontWeight: 600,
          lineHeight: '15px',
          height: 15
        }}
      >
        {props.children}
      </span>
      <span
        css={{
          width: 16,
          height: 4,
          borderRadius: 1,
          background: props.value,
          boxShadow: `inset 0 0 0 1px ${ZINC[200]}`
        }}
      />
      <CommitColorInput {...props} bare />
    </span>
  );
}

export function CommitColorInput(props: {
  disabled?: boolean;
  value: string;
  onCommit: (value: string) => void;
  title: string;
  /** Fill the parent ColorControl invisibly instead of rendering a swatch. */
  bare?: boolean;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const commitRef = useRef(props.onCommit);
  const committedValueRef = useRef(props.value.toLowerCase());
  const fallbackTimerRef = useRef<number | null>(null);
  commitRef.current = props.onCommit;

  useEffect(() => {
    const input = inputRef.current;
    if (!input) return;
    const commit = () => {
      if (fallbackTimerRef.current !== null)
        featheryWindow().clearTimeout(fallbackTimerRef.current);
      fallbackTimerRef.current = null;
      const value = input.value.toLowerCase();
      if (value === committedValueRef.current) return;
      committedValueRef.current = value;
      commitRef.current(value);
    };
    const scheduleFallback = () => {
      if (fallbackTimerRef.current !== null)
        featheryWindow().clearTimeout(fallbackTimerRef.current);
      fallbackTimerRef.current = featheryWindow().setTimeout(commit, 300);
    };
    // React maps color-input `onChange` to the continuously firing native
    // `input` event. Prefer native `change` so history is written once when the
    // picker is accepted. Some native pickers omit it, so a quiet-period
    // fallback commits only the final input value instead of making every drag
    // sample a history entry.
    input.addEventListener('input', scheduleFallback);
    input.addEventListener('change', commit);
    return () => {
      input.removeEventListener('input', scheduleFallback);
      input.removeEventListener('change', commit);
      if (fallbackTimerRef.current !== null)
        featheryWindow().clearTimeout(fallbackTimerRef.current);
    };
  }, []);

  useEffect(() => {
    const value = props.value.toLowerCase();
    committedValueRef.current = value;
    if (inputRef.current && inputRef.current.value !== value)
      inputRef.current.value = value;
  }, [props.value]);

  return (
    <input
      ref={inputRef}
      disabled={props.disabled}
      type='color'
      defaultValue={props.value}
      css={
        props.bare
          ? {
              position: 'absolute',
              inset: 0,
              width: '100%',
              height: '100%',
              opacity: 0,
              cursor: props.disabled ? 'default' : 'pointer',
              border: 'none',
              padding: 0
            }
          : styles.color
      }
      title={props.title}
      aria-label={props.title}
    />
  );
}
