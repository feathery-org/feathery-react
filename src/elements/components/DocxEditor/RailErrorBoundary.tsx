import React from 'react';

// One retry per failure, twice at most: enough for a transient fault to clear,
// too few to loop or flicker if the fault is real and immediate.
const RAIL_RETRY_LIMIT = 2;
const RAIL_RETRY_DELAY_MS = 250;

// The side panels overlay the document — no failure inside one may take down the
// host form. Without this, a teardown race against a destroyed Syncfusion
// instance (step navigation, remount) escapes to the form's own boundary and
// ejects the user from their step. Exported for tests.
//
// Hiding the panel is the containment, but hiding it FOREVER is a defect of its
// own: one transient read - an instance destroyed under a mid-flight refresh -
// used to cost the reviewer their review surface for the rest of the session,
// with the pending changes still in the document and no way to see them. So a
// failure is retried, briefly and a bounded number of times. A fault that
// reproduces re-latches on the retry and stays hidden; the retry budget is
// restored whenever the panel is remounted for a new editor or a reopened
// document (see the `key` at the render site).
export class RailErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { failed: boolean }
> {
  state = { failed: false };
  private retries = 0;
  private retryTimer: ReturnType<typeof setTimeout> | undefined;

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: unknown) {
    console.warn(
      'Feathery: tracked-changes panel failed and was hidden.',
      error
    );
    if (this.retries >= RAIL_RETRY_LIMIT) return;
    this.retries++;
    this.retryTimer = setTimeout(
      () => this.setState({ failed: false }),
      RAIL_RETRY_DELAY_MS
    );
  }

  componentWillUnmount() {
    if (this.retryTimer) clearTimeout(this.retryTimer);
  }

  render() {
    return this.state.failed ? null : this.props.children;
  }
}
