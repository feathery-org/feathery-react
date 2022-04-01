import { IMaskInput } from 'react-imask';
import React, { memo } from 'react';

import InlineTooltip from '../components/Tooltip';
import { bootstrapStyles } from '../styles';
import { emailPatternStr } from '../../utils/formHelperFunctions';

const MAX_TEXT_FIELD_LENGTH = 512;

function escapeDefinitionChars(str) {
  return str
    .replace('0', '\\0')
    .replace('a', '\\a')
    .replace('b', '\\b')
    .replace('*', '\\*');
}

function constraintChar(allowed) {
  switch (allowed) {
    case 'letters':
      return 'a';
    case 'alphanumeric':
      return 'b';
    case 'digits':
      return '0';
    default:
      return '*';
  }
}

function getTextFieldMask(servar) {
  const data = servar.metadata;
  const prefix = escapeDefinitionChars(data.prefix || '');
  const suffix = escapeDefinitionChars(data.suffix || '');

  let mask = '';
  if (data.mask) mask = data.mask;
  else {
    const definitionChar = constraintChar(data.allowed_characters);
    let numOptional = MAX_TEXT_FIELD_LENGTH - prefix.length - suffix.length;
    if (servar.max_length)
      numOptional = Math.min(servar.max_length, numOptional);
    mask = `[${definitionChar.repeat(numOptional)}]`;
  }

  // Approximate dynamic input by making each character optional
  return `${prefix}${mask}${suffix}`;
}

function getMaskProps(servar, value) {
  let methods, maskProps;
  switch (servar.type) {
    case 'integer_field':
      maskProps = {
        mask: servar.format === 'currency' ? '$num' : 'num',
        blocks: {
          num: {
            mask: Number,
            thousandsSeparator: ',',
            scale: 0,
            signed: false
          }
        },
        value: value.toString()
      };
      break;
    case 'login':
      methods = servar.metadata.login_methods;
      maskProps = {
        mask: methods.map((method) => {
          return {
            method,
            mask: method === 'phone' ? '(000) 000-0000' : /.+/
          };
        })
      };
      break;
    case 'phone_number':
      maskProps = { mask: '(000) 000-0000' };
      break;
    case 'ssn':
      maskProps = { mask: '000 - 00 - 0000' };
      break;
    case 'email':
    case 'text_area':
    case 'url':
      maskProps = { mask: /.+/ };
      break;
    default:
      maskProps = {
        mask: getTextFieldMask(servar),
        definitions: {
          b: /[a-zA-Z0-9]/
        },
        maxLength: MAX_TEXT_FIELD_LENGTH
      };
      break;
  }
  return {
    ...maskProps,
    lazy: false,
    unmask: !servar.metadata.save_mask
  };
}

function getInputProps(servar, styles) {
  let methods, onlyPhone;
  switch (servar.type) {
    case 'integer_field':
      return { type: 'tel' };
    case 'email':
      return {
        type: 'email',
        pattern: emailPatternStr
      };
    case 'login':
      methods = servar.metadata.login_methods;
      onlyPhone = methods.length === 1 && methods[0] === 'phone';
      return { type: onlyPhone ? 'tel' : 'text' };
    case 'phone_number':
      return { type: 'tel' };
    case 'ssn':
      return { type: 'tel' };
    case 'text_area':
      return {
        as: 'textarea',
        rows: styles.num_rows
      };
    case 'url':
      return { type: 'url' };
    default:
      return {};
  }
}

function TextField({
  element,
  applyStyles,
  fieldLabel,
  elementProps = {},
  required = false,
  onAccept = () => {},
  onBlur = () => {},
  onClick = () => {},
  rawValue = '',
  autoFocus,
  inlineError,
  children
}) {
  const servar = element.servar;

  const inputProps = getInputProps(servar, element.styles);
  const inputType = inputProps.as === 'textarea' ? 'textarea' : 'input';
  return (
    <div
      css={{
        maxWidth: '100%',
        position: 'relative',
        ...applyStyles.getTarget('fc')
      }}
      {...elementProps}
    >
      {fieldLabel}
      <div
        css={{
          position: 'relative',
          width: '100%',
          ...(inputType === 'textarea'
            ? {}
            : {
                whiteSpace: 'nowrap',
                overflowX: 'hidden'
              }),
          ...applyStyles.getTarget('sub-fc')
        }}
      >
        <IMaskInput
          id={servar.key}
          css={{
            height: '100%',
            width: '100%',
            ...bootstrapStyles,
            ...applyStyles.getTarget('field'),
            ...(inlineError ? { borderColor: '#F42525' } : {}),
            '&:focus': applyStyles.getTarget('active'),
            '&:hover': applyStyles.getTarget('hover'),
            '&:not(:focus)':
              rawValue || !element.properties.placeholder
                ? {}
                : { color: 'transparent !important' }
          }}
          maxLength={servar.max_length}
          minLength={servar.min_length}
          required={required}
          onBlur={onBlur}
          onClick={onClick}
          autoComplete={servar.metadata.autocomplete || 'on'}
          placeholder=''
          autoFocus={autoFocus}
          value={rawValue}
          {...inputProps}
          {...getMaskProps(servar, rawValue)}
          onAccept={onAccept}
        />
        <span
          css={{
            position: 'absolute',
            pointerEvents: 'none',
            left: '0.75rem',
            transition: '0.2s ease all',
            top: inputType === 'textarea' ? '0.375rem' : '50%',
            ...applyStyles.getTarget('placeholder'),
            ...(rawValue ? applyStyles.getTarget('placeholderFocus') : {}),
            [`${inputType}:focus + &`]: {
              ...applyStyles.getTarget('placeholderFocus'),
              ...applyStyles.getTarget('placeholderActive')
            }
          }}
        >
          {element.properties.placeholder || ''}
        </span>
        {element.properties.tooltipText && (
          <InlineTooltip
            id={`tooltip-${element.id}`}
            text={element.properties.tooltipText}
            applyStyles={applyStyles}
          />
        )}
      </div>
      {children}
    </div>
  );
}

export default memo(TextField);
