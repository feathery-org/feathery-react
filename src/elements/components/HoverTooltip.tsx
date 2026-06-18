import React, { RefObject } from 'react';
import type { Interpolation, Theme } from '@emotion/react';
import { Tooltip } from './Tooltip';
import Overlay, { Placement } from './Overlay';

interface HoverTooltipProps {
  show: boolean;
  triggerRef: RefObject<HTMLElement | null>;
  text: string; // display text; caller resolves field replacement before passing
  id: string;
  onHide: () => void;
  containerRef?: RefObject<HTMLElement | null>;
  placement?: Placement;
  offset?: number;
  css?: Interpolation<Theme>;
  maxWidth?: string;
}

/**
 * Shared overlay-anchored tooltip used by InlineTooltip (field help icon),
 * TextHoverTooltip (hoverable text), and container hover tooltips. Renders the
 * styled Tooltip inside an Overlay anchored to the provided trigger ref. The
 * caller owns the show state and the trigger element + its event handlers.
 */
export default function HoverTooltip({
  show,
  triggerRef,
  text,
  id,
  onHide,
  containerRef,
  placement = 'top',
  offset = 4,
  css,
  maxWidth
}: HoverTooltipProps) {
  if (!text) return null;

  return (
    <Overlay
      show={show}
      targetRef={triggerRef}
      containerRef={containerRef}
      placement={placement}
      onHide={onHide}
      offset={offset}
    >
      <Tooltip id={`tooltip-${id}`} css={css} maxWidth={maxWidth}>
        {text}
      </Tooltip>
    </Overlay>
  );
}
