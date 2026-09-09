/**
 * The rule that decides whether the captain SEES a pending change set.
 *
 * Written after the failure it exists to prevent, measured in the captain's own
 * browser on 2026-09-09: a split landed with 41 pending edits in one group, the
 * rail built the card and its Accept all button correctly, and all of it sat
 * under a `display: none` wrapper because the side panel was showing Sections.
 * The engine was right, the rail was right, and the change was unreachable.
 *
 * The closing half of the rule was already implemented and had never been
 * tested either; both halves are asserted here.
 */
import React from 'react';
import { render } from '@testing-library/react';
import {
  ActivePanel,
  nextActivePanel,
  useReviewPanelPresentation
} from './reviewPanelPresentation';

const decide = (
  activePanel: ActivePanel,
  previousCount: number,
  count: number,
  reviewChanges = true
) => nextActivePanel({ activePanel, previousCount, count, reviewChanges });

describe('which panel a pending change set puts on screen', () => {
  it('PRESENTS the changes panel when the document goes from no edits to some', () => {
    // The captain-blocking case, from every starting position the panel can be
    // in when a change set lands.
    expect(decide(null, 0, 41)).toBe('changes');
    expect(decide('sections', 0, 41)).toBe('changes');
  });

  it('leaves a panel already showing changes alone', () => {
    // Not "no opinion" by accident: re-setting it would be a no-op, but saying
    // undefined keeps the host from re-rendering on every count change.
    expect(decide('changes', 0, 41)).toBeUndefined();
  });

  it('does NOT drag the user back once they have moved away with edits pending', () => {
    // The rising edge is the whole point. Someone who closed the panel, or went
    // to Sections, while 41 edits are still pending has said where they want to
    // be, and no later render may overrule that.
    expect(decide(null, 41, 41)).toBeUndefined();
    expect(decide('sections', 41, 41)).toBeUndefined();
    expect(decide(null, 41, 40)).toBeUndefined();
    // More edits arriving inside a review the user is already looking away from
    // is still not a fresh transition from zero.
    expect(decide('sections', 41, 46)).toBeUndefined();
  });

  it('speaks again for a NEW change set after the last one resolved', () => {
    expect(decide(null, 0, 5)).toBe('changes');
  });

  it('CLOSES the changes panel when the last edit resolves', () => {
    expect(decide('changes', 41, 0)).toBeNull();
  });

  it('closes it even when reviewing has been switched off', () => {
    // The empty-slot rule is about what is on screen now, so it does not
    // consult the review flag - an open, empty changes panel must go either way.
    expect(decide('changes', 41, 0, false)).toBeNull();
  });

  it('never presents the panel when reviewing is off, since it is not offered', () => {
    expect(decide(null, 0, 41, false)).toBeUndefined();
    expect(decide('sections', 0, 41, false)).toBeUndefined();
  });

  it('leaves Sections alone when nothing is pending', () => {
    expect(decide('sections', 0, 0)).toBeUndefined();
    expect(decide(null, 0, 0)).toBeUndefined();
  });
});

describe('the hook that applies it', () => {
  function Host({
    count,
    reviewChanges = true,
    onChange
  }: {
    count: number;
    reviewChanges?: boolean;
    onChange: (panel: ActivePanel) => void;
  }) {
    const [activePanel, setActivePanel] =
      React.useState<ActivePanel>('sections');
    useReviewPanelPresentation({
      activePanel,
      count,
      reviewChanges,
      setActivePanel: (panel) => {
        setActivePanel(panel);
        onChange(panel);
      }
    });
    return <div data-testid='panel'>{activePanel ?? 'none'}</div>;
  }

  it('switches a Sections panel to changes when a change set lands', () => {
    const seen: ActivePanel[] = [];
    const view = render(<Host count={0} onChange={(p) => seen.push(p)} />);
    expect(view.getByTestId('panel').textContent).toBe('sections');

    view.rerender(<Host count={41} onChange={(p) => seen.push(p)} />);
    expect(view.getByTestId('panel').textContent).toBe('changes');
    expect(seen).toEqual(['changes']);
  });

  it('closes again when the edits resolve, and does not reopen on a still-zero count', () => {
    const seen: ActivePanel[] = [];
    const view = render(<Host count={0} onChange={(p) => seen.push(p)} />);
    view.rerender(<Host count={41} onChange={(p) => seen.push(p)} />);
    view.rerender(<Host count={0} onChange={(p) => seen.push(p)} />);
    expect(view.getByTestId('panel').textContent).toBe('none');
    view.rerender(<Host count={0} onChange={(p) => seen.push(p)} />);
    expect(seen).toEqual(['changes', null]);
  });

  it('does not reopen while the same edits stay pending', () => {
    const seen: ActivePanel[] = [];
    const view = render(<Host count={41} onChange={(p) => seen.push(p)} />);
    // The first evaluation is itself a transition from the ref's initial zero,
    // so a host mounted with edits already pending does present them.
    expect(view.getByTestId('panel').textContent).toBe('changes');
    view.rerender(<Host count={41} onChange={(p) => seen.push(p)} />);
    expect(seen).toEqual(['changes']);
  });
});
