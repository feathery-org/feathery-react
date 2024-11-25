import { evalComparisonRule, ResolvedComparisonRule } from './logic';
import { TEXT_VARIABLE_PATTERN } from '../elements/components/TextNodes';
import { fieldValues } from './init';
import { getDefaultFieldValue } from './formHelperFunctions';
import {
  getRepeatedContainer,
  getRepeatedContainers,
  isParentPosition
} from './repeat';

interface FlatHideRule extends ResolvedComparisonRule {
  index: number;
}

/**
 * Gets the set of elements that are referenced in a hide if rule for any of the elements.
 * Useful for knowing a field is involved in a rule.
 * @param elements
 * @returns Map<fieldKey, Set<Index>>
 */
function getHideIfReferences(
  elements: [
    {
      hide_ifs: FlatHideRule[];
      show_logic: boolean;
    },
    string
  ][]
): Set<string> {
  const refSet = new Set<string>();
  elements.forEach(([element]) => {
    element.hide_ifs.forEach((hideRule) => {
      // add the left side field
      refSet.add(hideRule.field_key);
      // add any right side fields
      hideRule.values.forEach(
        (v) => typeof v === 'object' && refSet.add(v.field_key)
      );
    });
  });
  return refSet;
}

function reshapeHideIfs(hideIfs: any): ResolvedComparisonRule[][] {
  const max =
    hideIfs.length === 0
      ? 0
      : Math.max(...hideIfs.map((hideIf: any) => hideIf.index)) + 1;
  const reshaped = Array.from(
    new Array(max),
    (): ResolvedComparisonRule[] => []
  );
  hideIfs.forEach((hideIf: any) => {
    reshaped[hideIf.index].push(hideIf);
  });
  return reshaped;
}
/**
 * Determines if the provided element should be hidden based on its "hide-if" rules.
 */
function shouldElementHide(
  { show_logic: show, hide_ifs: hideIfs }: any,
  repeat?: number,
  internalId?: string
) {
  // The show behavior can be either show (true) or hide (false).
  // If there are no hide_if rules, then the default is to show.
  // Otherwise, the rules are evaluated and if true then the show behavior is followed.
  if (!hideIfs || hideIfs.length === 0) return false;
  const reshapedHideIfs = reshapeHideIfs(hideIfs ?? []);

  const result = reshapedHideIfs.some((hideIfRules: ResolvedComparisonRule[]) =>
    hideIfRules.every((rule) => evalComparisonRule(rule, repeat, internalId))
  );
  return show ? !result : result;
}

const getTextVariables = (el: any) => {
  let textVariables = [];

  const text = el?.properties?.text;
  if (text) {
    const match = text.match(TEXT_VARIABLE_PATTERN);
    if (match) textVariables = match;
  }

  return textVariables.map((variable: any) => variable.slice(2, -2));
};

const repeatCountByTextVariables = (
  step: any,
  repeatKey: string | undefined
) => {
  let textVariables: string[] = [];
  [...step.buttons, ...step.texts]
    .filter(
      (el: any) =>
        repeatKey && isParentPosition(keyToPosition(repeatKey), el.position)
    )
    .forEach((el: any) => {
      textVariables = [...textVariables, ...getTextVariables(el)];
    });

  let count = 0;
  textVariables.forEach((variable) => {
    const variableValues = fieldValues[variable];
    if (Array.isArray(variableValues))
      count = Math.max(count, variableValues.length);
  });
  return count;
};

const repeatCountByFields = (step: any, repeatKey: string | undefined) => {
  const repeatableServars: Array<any> = step.servar_fields.filter(
    (field: any) =>
      field.servar.repeated &&
      repeatKey &&
      isParentPosition(keyToPosition(repeatKey), field.position)
  );
  let count = 0;
  repeatableServars.forEach((servar) => {
    count = Math.max(count, getServarRepeatNum(servar));
  });
  return count;
};

// If the final value is still default, do not render another repeat
const getServarRepeatNum = (node: any) => {
  const servar = node.servar ?? {};
  const fieldValue = fieldValues[servar.key ?? ''];
  if (!Array.isArray(fieldValue)) return 0;

  const defaultValue = getDefaultFieldValue(node);
  const hasDefaultLastValue =
    fieldValue[fieldValue.length - 1] === defaultValue;
  return servar.repeat_trigger === 'set_value' && !hasDefaultLastValue
    ? fieldValue.length + 1
    : fieldValue.length;
};

const stepElementTypes = [
  'subgrids',
  'texts',
  'buttons',
  'servar_fields',
  'progress_bars',
  'images',
  'videos'
];

const getPositionKey = (node: any) => {
  if (!node.position) return null;
  return node.position.join(',') || 'root';
};

const keyToPosition = (positionKey: string): number[] => {
  if (positionKey === 'root') return [];
  return positionKey.split(',').map(Number);
};

export type VisiblePositions = Record<string, boolean[]>;

function _collectHideFlags(
  step: any,
  element: any,
  visiblePositions: VisiblePositions,
  hiddenPositions: Record<string, number[]>,
  repeatKeys: string[],
  internalId: string
) {
  const elementPosition = element.position;
  const repeatKey = repeatKeys.find((key) =>
    isParentPosition(keyToPosition(key), elementPosition)
  );

  const numRepeats = Math.max(
    repeatCountByFields(step, repeatKey),
    repeatCountByTextVariables(step, repeatKey),
    1
  );

  const curRepeats = repeatKey ? numRepeats : 1;
  const elKey = getPositionKey(element);

  const visible: boolean[] = [];
  for (let i = 0; i < curRepeats; i++) {
    let shouldHide = shouldElementHide(
      element,
      repeatKey ? i : undefined,
      internalId
    );
    if (shouldHide) {
      if (!(elKey in hiddenPositions)) hiddenPositions[elKey] = [];
      hiddenPositions[elKey].push(i);
    }
    shouldHide =
      shouldHide ||
      Object.entries(hiddenPositions).some(([key, indices]) => {
        const parentPosition = keyToPosition(key);
        const repeatParentHidden =
          repeatKey &&
          key !== repeatKey &&
          isParentPosition(parentPosition, keyToPosition(repeatKey));

        return (
          isParentPosition(parentPosition, elementPosition) &&
          (indices.includes(i) || repeatParentHidden)
        );
      });
    visible.push(!shouldHide);
  }
  visiblePositions[elKey] = visible;
}

function getVisiblePositions(step: any, internalId: string) {
  const repeatGrids = getRepeatedContainers(step);
  const repeatKeys = repeatGrids.map(getPositionKey);
  const visiblePositions: VisiblePositions = {};

  // Efficient data structure for tracking hidden elements
  const hiddenPositions: Record<string, number[]> = {};

  step.subgrids
    .sort((grid1: any, grid2: any) =>
      grid1.position.length > grid2.position.length ? 1 : -1
    )
    .forEach((grid: any) => {
      _collectHideFlags(
        step,
        grid,
        visiblePositions,
        hiddenPositions,
        repeatKeys,
        internalId
      );
    });

  const elementTypes = [...stepElementTypes];
  const typeIndex = elementTypes.indexOf('subgrids');
  elementTypes.splice(typeIndex, 1);
  elementTypes.forEach((elementType) => {
    step[elementType].forEach((el: any) => {
      _collectHideFlags(
        step,
        el,
        visiblePositions,
        hiddenPositions,
        repeatKeys,
        internalId
      );
    });
  });

  return visiblePositions;
}

function getVisibleElements(
  step: any,
  visiblePositions: VisiblePositions,
  elementTypes: string[] = [],
  repeat = false
) {
  return elementTypes.flatMap((type) =>
    step[type].flatMap((el: any) => {
      const repeatGrid = getRepeatedContainer(step, el);
      const elKey = getPositionKey(el);
      const elements: any[] = [];
      const flags = visiblePositions[elKey];
      flags.forEach((flag, index) => {
        if (flag && (repeat || !elements.length)) {
          elements.push({
            element: el,
            type,
            repeat: repeatGrid ? index : undefined,
            last: index === flags.length - 1
          });
        }
      });
      return elements;
    })
  );
}

export {
  shouldElementHide,
  getHideIfReferences,
  getVisibleElements,
  getVisiblePositions,
  stepElementTypes,
  getPositionKey
};
