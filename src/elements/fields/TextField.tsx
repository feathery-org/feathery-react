import { IMaskInput } from 'react-imask';
import React, { memo } from 'react';

import Placeholder from '../components/Placeholder';
import InlineTooltip from '../components/Tooltip';
import { bootstrapStyles, ERROR_COLOR } from '../styles';
import { emailPatternStr } from '../../utils/validation';

const MAX_TEXT_FIELD_LENGTH = 512;

function escapeDefinitionChars(str: any) {
  return str
    .replaceAll('0', '\\0')
    .replaceAll('a', '\\a')
    .replaceAll('b', '\\b')
    .replaceAll('*', '\\*');
}

function constraintChar(allowed: any) {
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

function getTextFieldMask(servar: any) {
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

function getMaskProps(servar: any, value: any) {
  let maskProps;
  switch (servar.type) {
    case 'integer_field':
      maskProps = {
        mask: 'num',
        blocks: {
          num: {
            mask: Number,
            radix: '.',
            thousandsSeparator: ',',
            signed: false,
            scale: 0,
            // Larger numbers get converted to scientific notation when sent to backend
            max: Number.MAX_SAFE_INTEGER,
            min: Number.MIN_SAFE_INTEGER
          }
        },
        value: value.toString()
      };
      if (servar.format === 'currency') {
        maskProps.mask = '$num';
        maskProps.blocks.num.scale = 2;
      }
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

function getInputProps(servar: any) {
  switch (servar.type) {
    case 'integer_field':
      return { type: 'tel' };
    case 'email':
      return {
        type: 'email',
        pattern: emailPatternStr
      };
    case 'ssn':
      return { type: 'tel' };
    case 'url':
      return { type: 'url' };
    default:
      return {};
  }
}

function TextField({
  element,
  responsiveStyles,
  fieldLabel,
  elementProps = {},
  required = false,
  editMode,
  onAccept = () => {},
  onBlur = () => {},
  setRef = () => {},
  rawValue = '',
  inlineError,
  children
}: any) {
  const servar = element.servar;
  const inputProps = getInputProps(servar);
  return (
    <div
      css={{
        maxWidth: '100%',
        position: 'relative',
        pointerEvents: editMode ? 'none' : 'auto',
        ...responsiveStyles.getTarget('fc')
      }}
      {...elementProps}
    >
      {children}
      {fieldLabel}
      <div
        css={{
          position: 'relative',
          width: '100%',
          whiteSpace: 'nowrap',
          overflowX: 'hidden',
          ...responsiveStyles.getTarget('sub-fc')
        }}
      >
        <IMaskInput
          id={servar.key}
          css={{
            height: '100%',
            width: '100%',
            ...bootstrapStyles,
            ...responsiveStyles.getTarget('field'),
            ...(inlineError ? { borderColor: ERROR_COLOR } : {}),
            '&:focus': responsiveStyles.getTarget('active'),
            '&:hover': responsiveStyles.getTarget('hover'),
            '&:not(:focus)':
              rawValue || !element.properties.placeholder
                ? {}
                : { color: 'transparent !important' }
          }}
          maxLength={servar.max_length}
          minLength={servar.min_length}
          required={required}
          onBlur={onBlur}
          autoComplete={servar.metadata.autocomplete || 'on'}
          placeholder=''
          value={rawValue}
          inputRef={setRef}
          {...inputProps}
          {...getMaskProps(servar, rawValue)}
          onAccept={onAccept}
        />
        <Placeholder
          value={rawValue}
          element={element}
          responsiveStyles={responsiveStyles}
        />
        <InlineTooltip element={element} responsiveStyles={responsiveStyles} />
      </div>
    </div>
  );
}

export default memo(TextField);
