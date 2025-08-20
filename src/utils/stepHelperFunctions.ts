import { ACTION_NEXT, ACTION_URL } from './elementActions';
import { evalComparisonRule, ResolvedComparisonRule } from './logic';

export function changeStep(
  newKey: string,
  oldKey: string,
  steps: any,
  setStepKey: any,
  navigate: any,
  client: any,
  trackHashes?: boolean
) {
  const sameKey = oldKey === newKey;
  if (!sameKey && newKey) {
    if (newKey in steps) {
      client.registerEvent({
        step_key: oldKey,
        next_step_key: newKey,
        event: 'complete'
      });
      if (trackHashes)
        navigate(location.pathname + location.search + `#${newKey}`, {
          replace: true
        });
      setStepKey(newKey);
      return true;
    } else console.warn(`${newKey} is not a valid step to navigate to`);
  }
  return false;
}

export function getNewStepUrl(stepKey: any) {
  return location.pathname + location.search + `#${stepKey}`;
}

export function getPrevStepKey(curStep: any, stepMap: Record<string, string>) {
  let newStepKey = stepMap[curStep.key];
  if (!newStepKey) {
    const prevCondition = curStep.previous_conditions[0];
    if (prevCondition) newStepKey = prevCondition.previous_step_key;
  }
  return newStepKey;
}

export const nextStepKey = (nextConditions: any, metadata: any) => {
  let newKey: any = null;
  nextConditions
    .filter(
      (cond: any) =>
        cond.element_type === metadata.elementType &&
        metadata.elementIDs.includes(cond.element_id) &&
        cond.metadata.start === metadata.start &&
        cond.metadata.end === metadata.end
    )
    .sort((cond1: any, cond2: any) => {
      return cond1.rules.length < cond2.rules.length ? 1 : -1;
    })
    .forEach((cond: any) => {
      if (newKey) return;
      let rulesMet = true;
      cond.rules.forEach((rule: ResolvedComparisonRule) => {
        rulesMet &&= evalComparisonRule(rule);
      });
      if (rulesMet) newKey = cond.next_step_key;
    });
  return newKey;
};

// No origin is possible if there are no steps, e.g. form is disabled
const NO_ORIGIN_DEFAULT = { key: '' };
export const getOrigin = (steps: any) =>
  Object.values(steps).find((step) => (step as any).origin) ??
  NO_ORIGIN_DEFAULT;

/**
 *
 * @returns Url hash without the #, or '' if decodeURI fails
 */
export function getUrlHash() {
  try {
    return decodeURI(location.hash.substr(1));
  } catch (e) {
    console.warn(e);
    return '';
  }
}

export function setUrlStepHash(navigate: any, steps: any, stepName: string) {
  // No hash necessary if form only has one step
  if (Object.keys(steps).length > 1) {
    navigate(location.pathname + location.search + `#${stepName}`, {
      replace: true
    });
  }
}

export function getInitialStep({
  initialStepId,
  steps,
  sessionCurrentStep,
  formId
}: {
  initialStepId: string;
  steps: any;
  sessionCurrentStep?: string;
  formId?: string;
}) {
  return (
    (formId && getSavedStepKey(formId)) || // saved step from remounting
    initialStepId ||
    sessionCurrentStep ||
    (getOrigin as any)(steps).key
  );
}

// Store current step keys for each form during remount
const savedStepKeys: Record<string, string> = {};

export function getSavedStepKey(formId: string): string | undefined {
  const savedKey = savedStepKeys[formId];
  if (savedKey) {
    delete savedStepKeys[formId];
    return savedKey;
  }
  return undefined;
}

export function setSavedStepKey(formId: string, stepKey: string) {
  savedStepKeys[formId] = stepKey;
}

export function isStepTerminal(step: any) {
  // If step is navigable to another step, it's not terminal
  if (step.next_conditions.length > 0) return false;

  if (
    step.servar_fields.some((field: any) => field.servar.required) &&
    step.buttons.some((b: any) => b.properties.submit)
  ) {
    // Not terminal if there is a required field on the step that can be saved
    return false;
  }

  const onlyExits = ['buttons', 'texts', 'subgrids'].every((key) =>
    step[key].every((b: any) =>
      (b.properties.actions ?? []).every(
        (action: any) => action.type === ACTION_URL
      )
    )
  );
  if (onlyExits && step.servar_fields.length === 0) return true;

  const hasNext = step.buttons.some((b: any) =>
    (b.properties.actions ?? []).some(
      (action: any) =>
        action.type === ACTION_NEXT ||
        (action.type === ACTION_URL && !action.open_tab)
    )
  );

  return !hasNext;
}

function _recurseQueue(
  depthMap: Record<string, any>,
  steps: any,
  hasProgressBar: boolean,
  queue: any[],
  altQueue?: any[]
) {
  while (queue.length > 0) {
    const [step, depth] = queue.shift();
    if (step.key in depthMap) continue;

    // Optionally filter only for steps with progress bar
    const missingBar = hasProgressBar && step.progress_bars.length === 0;
    depthMap[step.key] = missingBar ? 0 : depth;

    const incr = missingBar ? 0 : 1;
    step.next_conditions.forEach((condition: any) => {
      queue.push([steps[condition.next_step_key], depth + incr]);
    });
    // For calculating progress bar depth, deprioritize previous condition
    // depths relative to next conditions
    const previousQueue = hasProgressBar && altQueue ? altQueue : queue;
    step.previous_conditions.forEach((condition: any) => {
      previousQueue.push([steps[condition.previous_step_key], depth + incr]);
    });
  }
}

export const getStepDepthMap = (steps: any, hasProgressBar = false) => {
  const depthMap: Record<string, any> = {};
  const stepQueue = [[getOrigin(steps), 0]];
  const reverseQueue: any[] = [];
  _recurseQueue(depthMap, steps, hasProgressBar, stepQueue, reverseQueue);
  if (hasProgressBar)
    _recurseQueue(depthMap, steps, hasProgressBar, reverseQueue);
  return depthMap;
};

export const recurseProgressDepth = (steps: any, curKey: any) => {
  const depthMap = getStepDepthMap(steps, true);
  return [depthMap[curKey], Math.max(...Object.values(depthMap))];
};
