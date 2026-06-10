import { featheryWindow } from '../utils/browser';
import { initInfo } from '../utils/init';
import type { AnalyticsBrowser } from '@segment/analytics-next';

let segmentInstalled = false;

// Stubbed synchronously so events fired before the Segment chunk loads are
// queued and replayed rather than dropped by the call site's guard.
const BUFFERED_METHODS = ['track', 'page', 'identify'] as const;

type QueuedCall = [typeof BUFFERED_METHODS[number], any[]];

export function installSegment(segmentConfig: any) {
  if (!segmentConfig || segmentInstalled) return;
  segmentInstalled = true;

  // Don't clobber a customer's own Segment, whether fully loaded (`initialize`)
  // or still mid-load via the v1 snippet stub (`invoked`).
  const existing = featheryWindow().analytics;
  if (existing && (existing.initialize || existing.invoked)) {
    if (segmentConfig.metadata.identify_user)
      existing.identify(initInfo().userId);
    return;
  }

  const queue: QueuedCall[] = [];
  const buffer: Record<string, (...args: any[]) => void> = {};
  BUFFERED_METHODS.forEach((method) => {
    buffer[method] = (...args: any[]) => queue.push([method, args]);
  });
  featheryWindow().analytics = buffer;

  // Not awaited: the buffer covers the load gap, so blocking here would hold up
  // fetchSession (and first render) for Segment forms.
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

  const analytics = AnalyticsBrowserClass.load({
    writeKey: segmentConfig.metadata.api_key
  });
  analytics.catch((error: unknown) => {
    console.error('Feathery: Segment integration failed to initialize', error);
  });

  featheryWindow().analytics = analytics;

  analytics.page();
  if (segmentConfig.metadata.identify_user)
    analytics.identify(initInfo().userId);
  queue.forEach(([method, args]) => (analytics as any)[method](...args));
}
