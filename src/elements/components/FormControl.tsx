import React from 'react';

interface FormControlProps {
  type?: string;
  htmlSize?: number;
  css?: any;
  id?: string;
  value?: string;
  onChange?: (event: React.ChangeEvent<HTMLInputElement>) => void;
  onKeyDown?: (event: React.KeyboardEvent<HTMLInputElement>) => void;
  maxLength?: number;
  minLength?: number;
  required?: boolean;
  disabled?: boolean;
  [key: string]: any;
}

// Simple input used for the 'other' option in checkbox and radio groups
export function FormControl({
  type = 'text',
  htmlSize,
  css,
  id,
  value,
  onChange,
  onKeyDown,
  maxLength,
  minLength,
  required,
  disabled,
  ...props
}: FormControlProps) {
  return (
    <input
      type={type}
      size={htmlSize}
      css={{
        border: '1px solid #ced4da',
        borderRadius: '0.375rem',
        padding: '0.375rem 0.75rem',
        fontSize: '1rem',
        lineHeight: '1.5',
        color: '#495057',
        backgroundColor: '#fff',
        backgroundClip: 'padding-box',
        transition:
          'border-color 0.15s ease-in-out, box-shadow 0.15s ease-in-out',
        '&:focus': {
          borderColor: '#80bdff',
          outline: 0,
          boxShadow: '0 0 0 0.2rem rgba(0, 123, 255, 0.25)'
        },
        '&:disabled': {
          backgroundColor: '#e9ecef',
          opacity: 1
        },
        ...css
      }}
      id={id}
      value={value}
      onChange={onChange}
      onKeyDown={onKeyDown}
      maxLength={maxLength}
      minLength={minLength}
      required={required}
      disabled={disabled}
      {...props}
    />
  );
}

export default { FormControl };
