import { featheryWindow } from '../utils/browser';
import { initInfo } from '../utils/init';
import type { AnalyticsBrowser } from '@segment/analytics-next';

let segmentInstalled = false;

// Methods the rest of the SDK calls on `window.analytics` (see trackEvent in
// ./utils). We stub these synchronously so any event fired before the Segment
// chunk finishes downloading is queued and replayed, rather than silently
// dropped by the `if (window.analytics)` guard at the call site.
const BUFFERED_METHODS = ['track', 'page', 'identify'] as const;

type QueuedCall = [typeof BUFFERED_METHODS[number], any[]];

export function installSegment(segmentConfig: any) {
  if (!segmentConfig || segmentInstalled) return;
  segmentInstalled = true;

  // If a real (customer-loaded) Segment instance is already on the page, don't
  // clobber it — just respect it and optionally identify the user.
  const existing = featheryWindow().analytics;
  if (existing && existing.initialize) {
    if (segmentConfig.metadata.identify_user)
      existing.identify(initInfo().userId);
    return;
  }

  // Synchronous buffer: queue calls until the real instance is ready.
  const queue: QueuedCall[] = [];
  const buffer: Record<string, (...args: any[]) => void> = {};
  BUFFERED_METHODS.forEach((method) => {
    buffer[method] = (...args: any[]) => queue.push([method, args]);
  });
  featheryWindow().analytics = buffer;

  // Load the Segment chunk in the background. The synchronous buffer above
  // covers the load gap, so we deliberately don't await this — blocking here
  // would hold up fetchSession (and thus first render) for Segment forms.
  loadSegment(segmentConfig, queue);
}

async function loadSegment(segmentConfig: any, queue: QueuedCall[]) {
  let AnalyticsBrowserClass: typeof AnalyticsBrowser;
  try {
    ({ AnalyticsBrowser: AnalyticsBrowserClass } = await import(
      /* webpackChunkName: "segment" */ '@segment/analytics-next'
    ));
  } catch (error) {
    console.error(
      'Feathery: Segment integration failed to load analytics-next',
      error
    );
    return;
  }

  // `load` returns a buffered facade that queues calls until the underlying
  // script is ready, and is awaitable so we can surface initialization errors.
  const analytics = AnalyticsBrowserClass.load({
    writeKey: segmentConfig.metadata.api_key
  });
  analytics.catch((error: unknown) => {
    console.error('Feathery: Segment integration failed to initialize', error);
  });

  featheryWindow().analytics = analytics;

  // Open the session, then replay anything captured during the load gap.
  analytics.page();
  if (segmentConfig.metadata.identify_user)
    analytics.identify(initInfo().userId);
  queue.forEach(([method, args]) => (analytics as any)[method](...args));
}
