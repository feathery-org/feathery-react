import React, { PropsWithChildren, useRef, useState } from 'react';
import { StyledContainer, getCellStyle } from '../StyledContainer';
import { ACTION_STORE_FIELD } from '../../../utils/elementActions';
import HoverTooltip from '../../../elements/components/HoverTooltip';
import { replaceTextVariables } from '../../../elements/components/TextNodes';
import { isMobile as _isMobile } from '../../../utils/browser';
import { RepeatRowHandle, useRepeatRowReorder } from '../RepeatReorder';
import { ROW_ATTR, rowRevealStyles } from '../RepeatReorder/styles';

type ContainerProps = PropsWithChildren & {
  node: any;
  viewport: any;
  runElementActions?: any;
  selected?: boolean;
  form: {
    activeStep?: { id?: string; servar_fields?: any[]; subgrids?: any[] };
    formInstanceId?: string;
    formSettings: { mobileBreakpoint: number; assistantEnabled?: boolean };
    visiblePositions?: Record<string, boolean[]>;
    buttonLoaders?: Record<string, any>;
    moveRepeatedRow?: (container: any, from: number, to: number) => boolean;
    insertRepeatedRow?: (container: any, at: number) => boolean;
  };
};

/**
 * Container
 * This component adds additional logic to the StyledContainer that is unique
 * to rendering containers on hosted forms (not the editor).
 */
export const Container = ({
  node,
  runElementActions = () => {},
  selected,
  viewport,
  form,
  children
}: ContainerProps) => {
  const ref = useRef<HTMLDivElement>(null);
  const [showTooltip, setShowTooltip] = useState(false);
  const reorder = useRepeatRowReorder(node, form);
  const additionalCss: any = {};
  let handleClick: any;

  // Container-level hover tooltips apply only to actual containers. Field
  // elements share the same `tooltipText` property but render their own
  // icon-based InlineTooltip, so they must be excluded here.
  const tooltipText =
    !node.isElement && node.properties?.tooltipText
      ? replaceTextVariables(node.properties.tooltipText, node.repeat)
      : '';
  const isMobile = _isMobile();
  const tooltipHoverProps = tooltipText
    ? {
        // mouse hover is the primary trigger; disabled on mobile where a tap is
        // ambiguous (containers commonly carry click actions)
        onMouseEnter: isMobile ? undefined : () => setShowTooltip(true),
        onMouseLeave: isMobile ? undefined : () => setShowTooltip(false),
        onFocus: () => setShowTooltip(true),
        onBlur: () => setShowTooltip(false)
      }
    : {};

  if (!node.isElement) {
    const properties = node.properties ?? {};
    const actions = properties.actions ?? [];
    const [, cellHoverStyle = {}, cellActiveStyle = {}] = getCellStyle(
      node,
      undefined,
      form.formSettings.mobileBreakpoint
    );

    const selectableStyles =
      actions.length > 0
        ? {
            cursor: 'pointer',
            transition:
              '0.2s ease opacity, color, background-color, border-width, border-color, outline, box-shadow',
            ...(selected ? cellActiveStyle : {}),
            '&:hover': cellHoverStyle
          }
        : {};

    handleClick = (e: any) => {
      const newActions = JSON.parse(JSON.stringify(actions));
      newActions.forEach((action: any) => {
        if (
          action.type === ACTION_STORE_FIELD &&
          action.custom_store_field_key === e.target.id
        ) {
          // Don't run value changes for fields that were clicked and already had
          // their values changed
          action.retain_click_value = true;
        }
      });

      runElementActions({
        actions: newActions,
        element: node,
        elementType: 'container'
      });
    };

    Object.assign(additionalCss, selectableStyles);
  }

  // The row reveals its own chrome, so a resting form carries no furniture.
  if (reorder) Object.assign(additionalCss, rowRevealStyles);

  return (
    <>
      <StyledContainer
        ref={ref}
        node={node}
        css={additionalCss}
        onClick={handleClick}
        viewport={viewport}
        breakpoint={form.formSettings.mobileBreakpoint}
        formId={form.formInstanceId}
        stepId={form.activeStep?.id}
        assistantEnabled={form.formSettings.assistantEnabled}
        {...tooltipHoverProps}
        {...(reorder ? { [ROW_ATTR]: reorder.index } : {})}
        overlay={reorder ? <RepeatRowHandle {...reorder} /> : undefined}
      >
        {children}
      </StyledContainer>
      {tooltipText && (
        <HoverTooltip
          show={showTooltip}
          triggerRef={ref}
          text={tooltipText}
          id={node.id}
          onHide={() => setShowTooltip(false)}
          maxWidth='320px'
        />
      )}
    </>
  );
};
