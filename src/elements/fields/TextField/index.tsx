import React, { memo, useRef, useState } from 'react';

import Placeholder from '../../components/Placeholder';
import InlineTooltip from '../../components/InlineTooltip';
import { resetStyles } from '../../styles';
import { emailPatternStr } from '../../../utils/validation';
import useBorder from '../../components/useBorder';
import TextAutocomplete from './TextAutocomplete';
import { getFieldValue } from '../../../utils/fieldHelperFunctions';
import { stringifyWithNull } from '../../../utils/primitives';
import { FORM_Z_INDEX } from '../../../utils/styles';
import { hoverStylesGuard, iosScrollOnFocus } from '../../../utils/browser';
import { HideEyeIcon, ShowEyeIcon } from '../../components/icons';
import { IMaskInput } from 'react-imask';
import {
  getDecimalPlaces,
  getNumberMaskProps,
  getTextFieldMask,
  isSignWithoutMagnitude,
  maxFieldLength,
  roundToDecimalPlaces
} from './mask';
import { fieldAriaLabel } from '../shared/accessibleName';
import { sensitiveFieldProps } from '../shared/certification';

function getMaskProps(
  servar: any,
  value: any,
  showPassword: boolean,
  editing: boolean
) {
  let maskProps;
  // Max length included in mask for validation of typed inputs
  let maxLength = servar.max_length ?? maxFieldLength(servar.type);
  switch (servar.type) {
    case 'integer_field':
      maskProps = getNumberMaskProps(servar, value, editing);
      break;
    case 'ssn':
      maskProps = {
        // mask uses ∗ character which is like * but centered in inputs
        mask: servar.metadata.last_four_digits
          ? '∗∗∗ - ∗∗ - 0000'
          : '000 - 00 - 0000',
        // displayChar allows for secure entry without using password input
        // this prevents browser password manager from triggering on SSN fields
        displayChar: showPassword ? undefined : '∗',
        placeholderChar: servar.metadata.last_four_digits ? ' ' : undefined,
        lazy: !servar.metadata.last_four_digits
      };
      break;
    case 'email':
    case 'text_area':
    case 'url':
      maskProps = { mask: new RegExp(`^.{0,${maxLength}}$`), maxLength };
      break;
    default:
      if (servar.metadata.mask) maxLength = undefined;
      maskProps = {
        mask: getTextFieldMask(servar),
        definitions: {
          b: /[a-zA-Z0-9]/,
          c: /[a-zA-Z0-9 ]/
        },
        maxLength
      };
      break;
  }
  // Spread the defaults rather than inlining them so a per-type maskProps can
  // override them (the number mask forces unmask).
  const defaults = { lazy: false, unmask: !servar.metadata.save_mask };
  return { ...defaults, ...maskProps };
}

function getInputProps(servar: any, options: any[], autoComplete: boolean) {
  const constraints: Record<string, any> = {
    minLength: servar.min_length
  };
  // Max length included here for validation of programmatically set
  // inputs
  const maxLength = servar.max_length ?? maxFieldLength(servar.type);

  if (options.length > 0) constraints.autoComplete = 'off';

  const meta = servar.metadata;
  switch (servar.type) {
    case 'integer_field':
      // Offering a decimal point on a whole-number field is the main way users
      // hit imask's scale-0 behavior, where "12.5" resolves to 125.
      return {
        inputMode: (getDecimalPlaces(servar) === 0
          ? 'numeric'
          : 'decimal') as any
      };
    case 'email':
      if (autoComplete && !constraints.autoComplete) {
        constraints.autoComplete = 'email';
      }
      return {
        type: 'email',
        pattern: emailPatternStr,
        maxLength,
        ...constraints
      };
    case 'gmap_zip':
      if (autoComplete && !constraints.autoComplete) {
        constraints.autoComplete = 'postal-code';
      }
      return {
        ...constraints,
        maxLength,
        inputMode: (meta.allowed_characters === 'digits'
          ? 'numeric'
          : 'text') as any
      };
    case 'url':
      if (autoComplete && !constraints.autoComplete) {
        constraints.autoComplete = 'url';
        constraints.maxLength = maxLength;
      }
      return constraints;
    case 'ssn':
      return {
        inputMode: 'numeric' as any,
        ...constraints
      };
    default:
      constraints.maxLength = maxLength;
      if (meta.custom_autocomplete && !constraints.autoComplete)
        constraints.autoComplete = meta.custom_autocomplete;
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
  onAccept = () => {},
  onEnter = () => {},
  setRef = () => {},
  inlineError,
  repeatIndex = null,
  children
}: any) {
  const [showAutocomplete, setShowAutocomplete] = useState(false);
  // Hide SSNs by default
  const [showPassword, setShowPassword] = useState(false);
  // A number field accepts more decimals than it stores, so that a typed radix
  // is never dropped. While editing, the value is left at whatever precision
  // the user has typed; it snaps to the field's precision on the way out.
  //
  // A ref, not state: the sign a user types is held in the DOM until a
  // magnitude arrives, so any re-render during that hold erases it — and
  // toggling this on focus would do exactly that. Nothing needs a render of its
  // own here, since committing the rounded value already causes one.
  const editingRef = useRef(false);
  // A bare sign the input is holding on form state's behalf — see handleAccept.
  const heldSignRef = useRef('');
  const { borderStyles, customBorder, borderId } = useBorder({
    element,
    error: inlineError,
    breakpoint: responsiveStyles.getMobileBreakpoint()
  });
  const containerRef = useRef<HTMLDivElement>(null);
  const listItemRef = useRef<any[]>([]);
  const inputRef = useRef<{ element?: HTMLInputElement }>(null);
  const { value: fieldVal } = getFieldValue(element);
  const rawValue = stringifyWithNull(fieldVal);
  const rawValueRef = useRef(rawValue);
  rawValueRef.current = rawValue;

  const servar = element.servar;
  const options = (servar.metadata.options ?? []).filter((opt: string) => opt);

  // A number field's sign is typed before there is any magnitude to sign, and
  // that intermediate has no value to store — so let the input hold it rather
  // than round-tripping it through form state, which would erase it. Over an
  // existing value the clear is still committed, so a stale number can't
  // survive hidden behind a bare sign, but the sign itself is remembered here
  // and rendered back as the input's value: committing the clear re-renders
  // this controlled input, and pushing the emptied value down would wipe the
  // sign along with it — backspacing the last digit off "-0.1" would blank the
  // field instead of leaving "-0.".
  const handleAccept = (value: any, ...rest: any[]) => {
    if (servar.type === 'integer_field' && isSignWithoutMagnitude(value)) {
      heldSignRef.current = value;
      if (rawValue) onAccept('', ...rest);
      return;
    }
    heldSignRef.current = '';
    onAccept(value, ...rest);
  };
  // The sign to render in place of the empty stored value. Exactly what imask
  // last reported as its unmasked value, so react-imask — which compares the
  // value prop against that — finds them equal and leaves the input alone,
  // keeping a typed radix that the unmasked value alone would not carry.
  const heldSign = rawValue ? '' : heldSignRef.current;
  // Snap to the field's configured precision when editing ends. Anything finer
  // was only ever accepted so the radix could be typed at all.
  const commitPrecision = () => {
    if (servar.type !== 'integer_field') return;
    // Through the ref: react-imask keeps the handler it was given on mount, so
    // reading rawValue from this closure would see the value as it was then.
    const current = rawValueRef.current;
    if (isSignWithoutMagnitude(current)) return;
    const rounded = roundToDecimalPlaces(current, getDecimalPlaces(servar));
    if (rounded !== current) onAccept(rounded, {});
  };

  const spacing = element.properties.tooltipText ? 30 : 8;
  return (
    <div
      ref={containerRef}
      css={{
        maxWidth: '100%',
        width: '100%',
        height: '100%',
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
          // Prevent placeholder overflow
          overflowX: 'clip',
          ...responsiveStyles.getTarget('sub-fc'),
          ...(disabled ? responsiveStyles.getTarget('disabled') : {}),
          '&:focus-within': {
            ...responsiveStyles.getTarget('active'),
            ...borderStyles.active
          },
          '&:hover': hoverStylesGuard(
            disabled
              ? {}
              : {
                  ...responsiveStyles.getTarget('hover'),
                  ...borderStyles.hover
                }
          )
        }}
      >
        <TextAutocomplete
          allOptions={options}
          value={rawValue}
          showOptions={showAutocomplete}
          onSelect={(option) => {
            onAccept(option, {});
            setShowAutocomplete(false);
            inputRef.current?.element?.focus?.();
          }}
          responsiveStyles={responsiveStyles}
          containerRef={containerRef}
          listItemRef={listItemRef}
          onHide={() => setShowAutocomplete(false)}
          onInputFocus={() => inputRef.current?.element?.focus?.()}
        >
          <IMaskInput
            id={servar.key}
            name={servar.key}
            ref={inputRef}
            css={{
              position: 'relative',
              // Position input above the border div
              zIndex: FORM_Z_INDEX,
              height: '100%',
              width: '100%',
              border: 'none',
              margin: 0,
              backgroundColor: 'transparent',
              ...resetStyles,
              ...responsiveStyles.getTarget('field'),
              '&:focus': responsiveStyles.getTarget('field')['&:focus'],
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
            aria-label={fieldAriaLabel(element)}
            {...sensitiveFieldProps(element)}
            // Not on focus because if error is showing, it will
            // keep triggering dropdown after blur
            onKeyDown={(e: any) => {
              if (e.key === 'Enter') onEnter(e);
              else if (options.length) {
                if (!rawValue && ['Backspace', 'Delete'].includes(e.key))
                  return;
                if (['ArrowUp', 'ArrowLeft', 'ArrowRight'].includes(e.key))
                  return;
                setShowAutocomplete(e.key !== 'Escape');
                if (e.key === 'ArrowDown') {
                  setTimeout(
                    () =>
                      listItemRef.current[0]?.focus({
                        preventScroll: true
                      }),
                    0
                  );
                }
              }
            }}
            onBlur={(e: any) => {
              editingRef.current = false;
              // Nothing was stored for a held sign, so stop rendering one: the
              // next render of an untouched field should show it as empty.
              heldSignRef.current = '';
              commitPrecision();
              if (
                e.relatedTarget &&
                listItemRef.current.some(
                  (item: any) => item === e.relatedTarget
                )
              )
                return;
              if (options.length > 0) {
                // Blur may be triggered by option selection, and option
                // click logic may need to be run first. So delay option removal.
                setTimeout(() => setShowAutocomplete(false), EXIT_DELAY_TIME);
              }
            }}
            onFocus={(e: any) => {
              editingRef.current = true;
              iosScrollOnFocus(e);
            }}
            inputRef={setRef}
            {...getInputProps(servar, options, autoComplete === 'on')}
            {...getMaskProps(
              servar,
              heldSign || rawValue,
              showPassword,
              // A held sign is mid-entry by definition, so it is never rounded
              // — rounding "-0." would push "0" down and overwrite the sign.
              editingRef.current || Boolean(heldSign)
            )}
            onAccept={handleAccept}
          />
        </TextAutocomplete>
        {servar.type === 'ssn' && rawValue && (
          <div
            css={{
              position: 'absolute',
              cursor: 'pointer',
              insetInlineEnd: `${spacing}px`,
              // We need to subtract half the height of the icon to center it
              top: 'calc(50% - 12px)',
              zIndex: FORM_Z_INDEX
            }}
            onClick={() => setShowPassword((prev) => !prev)}
            aria-label='Toggle SSN visibility'
          >
            {showPassword ? <ShowEyeIcon /> : <HideEyeIcon />}
          </div>
        )}
        {customBorder}
        <Placeholder
          value={rawValue}
          element={element}
          responsiveStyles={responsiveStyles}
          repeatIndex={repeatIndex}
        />
        <InlineTooltip
          containerRef={containerRef}
          id={element.id}
          text={element.properties.tooltipText}
          responsiveStyles={responsiveStyles}
          repeat={element.repeat}
        />
      </div>
    </div>
  );
}

export default memo(TextField);
