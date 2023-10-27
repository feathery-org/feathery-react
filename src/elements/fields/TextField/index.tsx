import { IMaskInput } from 'react-imask';
import React, { memo, useState } from 'react';

import Placeholder from '../../components/Placeholder';
import InlineTooltip from '../../components/InlineTooltip';
import { bootstrapStyles } from '../../styles';
import { emailPatternStr } from '../../../utils/validation';
import useBorder from '../../components/useBorder';
import TextAutocomplete from './TextAutocomplete';

const MAX_TEXT_FIELD_LENGTH = 512;

function escapeDefinitionChars(str: string | undefined) {
  return (str ?? '')
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
  const prefix = escapeDefinitionChars(data.prefix);
  const suffix = escapeDefinitionChars(data.suffix);

  let mask = '';
  if (data.mask) mask = data.mask;
  else {
    let allowed = data.allowed_characters;
    if (servar.type === 'gmap_zip' && !allowed) allowed = 'alphanumeric';
    const definitionChar = constraintChar(allowed);

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
            scale: 2,
            // Larger numbers get converted to scientific notation when sent to backend
            max: servar.max_length ?? Number.MAX_SAFE_INTEGER,
            min: servar.min_length ?? Number.MIN_SAFE_INTEGER
          }
        },
        value: value.toString()
      };
      if (servar.format === 'currency') {
        maskProps.mask = '$num';
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
  const maxConstraints = {
    maxLength: servar.max_length,
    minLength: servar.min_length
  };

  const meta = servar.metadata;

  switch (servar.type) {
    case 'integer_field':
      return { inputmode: 'decimal' };
    case 'email':
      return {
        type: 'email',
        pattern: emailPatternStr,
        ...maxConstraints
      };
    case 'gmap_zip':
      return {
        inputmode: meta.allowed_characters === 'digits' ? 'tel' : 'text'
      };
    case 'ssn':
      return { inputmode: 'tel', ...maxConstraints };
    case 'url':
      return { type: 'url', ...maxConstraints };
    default:
      if (meta.number_keypad || meta.allowed_characters === 'digits') {
        return { inputmode: 'tel', ...maxConstraints };
      }
      return maxConstraints;
  }
}

const EXIT_DELAY_TIME = 200;

function TextField({
  element,
  responsiveStyles,
  fieldLabel,
  elementProps = {},
  required = false,
  disabled = false,
  editMode,
  rightToLeft,
  onAccept = () => {},
  onEnter = () => {},
  setRef = () => {},
  rawValue = '',
  inlineError,
  children
}: any) {
  const [showAutocomplete, setShowAutocomplete] = useState(false);
  const { borderStyles, customBorder, borderId } = useBorder({
    element,
    error: inlineError
  });

  const servar = element.servar;
  const options = servar.metadata.options ?? [];
  return (
    <div
      css={{
        maxWidth: '100%',
        width: '100%',
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
          ...responsiveStyles.getTarget('sub-fc'),
          ...(disabled ? responsiveStyles.getTarget('disabled') : {}),
          '&:hover': disabled
            ? {}
            : {
                ...responsiveStyles.getTarget('hover'),
                ...borderStyles.hover
              }
        }}
      >
        <TextAutocomplete
          allOptions={options}
          value={rawValue}
          showOptions={showAutocomplete}
          onSelect={(option) => {
            onAccept(option, {});
            setShowAutocomplete(false);
          }}
          responsiveStyles={responsiveStyles}
        >
          <IMaskInput
            id={servar.key}
            css={{
              position: 'relative',
              // Position input above the border div
              zIndex: 1,
              height: '100%',
              width: '100%',
              border: 'none',
              backgroundColor: 'transparent',
              ...bootstrapStyles,
              ...responsiveStyles.getTarget('field'),
              '&:focus': {
                ...responsiveStyles.getTarget('active'),
                ...borderStyles.active
              },
              [`&:focus ~ #${borderId}`]: Object.values(borderStyles.active)[0],
              '&:not(:focus)':
                rawValue || !element.properties.placeholder
                  ? {}
                  : { color: 'transparent !important' }
            }}
            required={required}
            disabled={disabled}
            autoComplete={
              options.length > 0 ? 'off' : servar.metadata.autocomplete || 'on'
            }
            placeholder=''
            value={rawValue}
            // Not on focus because if error is showing, it will
            // keep triggering dropdown after blur
            onKeyDown={(e) => {
              if (e.key === 'Enter') onEnter(e);
              else if (options.length) {
                setShowAutocomplete(e.key !== 'Escape');
              }
            }}
            onBlur={() => {
              if (options.length > 0) {
                // Blur may be triggered by option selection, and option
                // click logic may need to be run first. So delay option removal.
                setTimeout(() => setShowAutocomplete(false), EXIT_DELAY_TIME);
              }
            }}
            inputRef={setRef}
            {...getInputProps(servar)}
            {...getMaskProps(servar, rawValue)}
            onAccept={onAccept}
          />
        </TextAutocomplete>
        {customBorder}
        <Placeholder
          rightToLeft={rightToLeft}
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
