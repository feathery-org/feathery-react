import { IMaskInput } from 'react-imask';
import React, { memo, useState } from 'react';

import Placeholder from '../../components/Placeholder';
import InlineTooltip from '../../components/InlineTooltip';
import { bootstrapStyles } from '../../styles';
import { emailPatternStr } from '../../../utils/validation';
import useBorder from '../../components/useBorder';
import TextAutocomplete from './TextAutocomplete';
import BorderlessEyeIcon from '../../components/icons/BorderlessEyeIcon';
import { getFieldValue } from '../../../utils/formHelperFunctions';
import { stringifyWithNull } from '../../../utils/primitives';

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
    case 'alphaspace':
      return 'c';
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
    if (servar.type === 'gmap_zip' && !allowed) allowed = 'alphaspace';
    const definitionChar = constraintChar(allowed);

    let numOptional = MAX_TEXT_FIELD_LENGTH - prefix.length - suffix.length;
    if (servar.max_length)
      numOptional = Math.min(servar.max_length, numOptional);

    mask = `[${definitionChar.repeat(numOptional)}]`;
  }

  // Approximate dynamic input by making each character optional
  return `${prefix}${mask}${suffix}`;
}

function getMaskProps(servar: any, value: any, showPassword: boolean) {
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
      maskProps = {
        mask: showPassword ? '000 - 00 - 0000' : '000000000',
        lazy: true
      };
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
          b: /[a-zA-Z0-9]/,
          c: /[a-zA-Z0-9 ]/
        },
        maxLength: MAX_TEXT_FIELD_LENGTH
      };
      break;
  }
  return {
    lazy: false,
    unmask: !servar.metadata.save_mask,
    ...maskProps
  };
}

function getInputProps(
  servar: any,
  options: any[],
  autoComplete: boolean,
  showPassword: boolean
) {
  const constraints: Record<string, any> = {
    maxLength: servar.max_length,
    minLength: servar.min_length
  };
  if (options.length > 0) constraints.autoComplete = 'off';

  const meta = servar.metadata;
  switch (servar.type) {
    case 'integer_field':
      return { inputMode: 'decimal' as any };
    case 'email':
      if (autoComplete && !constraints.autoComplete) {
        constraints.autoComplete = 'email';
      }
      return {
        type: 'email',
        pattern: emailPatternStr,
        ...constraints
      };
    case 'gmap_zip':
      if (autoComplete && !constraints.autoComplete) {
        constraints.autoComplete = 'postal-code';
      }
      return {
        inputMode: (meta.allowed_characters === 'digits'
          ? 'numeric'
          : 'text') as any
      };
    case 'url':
      if (autoComplete && !constraints.autoComplete) {
        constraints.autoComplete = 'url';
      }
      return constraints;
    case 'ssn':
      return {
        inputMode: 'numeric' as any,
        type: showPassword ? 'text' : 'password',
        ...constraints
      };
    default:
      if (meta.number_keypad || meta.allowed_characters === 'digits') {
        return { inputMode: 'numeric' as any, ...constraints };
      }
      return constraints;
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
  autoComplete,
  editMode,
  rightToLeft,
  onAccept = () => {},
  onEnter = () => {},
  setRef = () => {},
  inlineError,
  children
}: any) {
  const [showAutocomplete, setShowAutocomplete] = useState(false);
  const [showPassword, setShowPassword] = useState(true);
  const { borderStyles, customBorder, borderId } = useBorder({
    element,
    error: inlineError
  });

  const { value: fieldVal } = getFieldValue(element);
  const rawValue = stringifyWithNull(fieldVal);

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
                ...responsiveStyles.getTarget('field')['&:focus'],
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
            placeholder=''
            value={rawValue}
            aria-label={element.properties.aria_label}
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
            {...getInputProps(servar, options, autoComplete, showPassword)}
            {...getMaskProps(servar, rawValue, showPassword)}
            onAccept={onAccept}
          />
        </TextAutocomplete>
        {servar.type === 'ssn' && rawValue && (
          <div
            css={{
              position: 'absolute',
              cursor: 'pointer',
              right: '8px',
              // We need to subtract half the height of the icon to center it
              top: 'calc(50% - 12px)',
              zIndex: 1
            }}
          >
            <BorderlessEyeIcon
              open={showPassword}
              onClick={() => setShowPassword((prev) => !prev)}
              aria-label='Toggle password visibility'
            />
          </div>
        )}
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
