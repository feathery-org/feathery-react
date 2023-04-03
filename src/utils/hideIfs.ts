import { evalComparisonRule, ResolvedComparisonRule } from './logic';

interface FlatHideRule extends ResolvedComparisonRule {
  index: number;
}

/**
 * Gets the set of elements that are referenced in a hide if rule for any of the elements.
 * Useful for knowing a field is involved in a rule.
 * @param elements
 * @returns Map<fieldKey, Set<Element>>
 */
function getHideIfReferences(
  elements: [
    {
      hide_ifs: FlatHideRule[];
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
function shouldElementHide(element: any) {
  const reshapedHideIfs = reshapeHideIfs(element.hide_ifs ?? []);

  return reshapedHideIfs.some((hideIfRules: ResolvedComparisonRule[]) =>
    hideIfRules.every((rule) => evalComparisonRule(rule, element.repeat))
  );
}

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

function getVisibleElements(step: any) {
  const visibleElements: Record<string, any> = {
    subgrids: {},
    positions: new Set()
  };
  const toIgnore: string[] = [];
  step.subgrids.forEach((subgrid: any) => {
    const gridKey = getPositionKey(subgrid);
    if (shouldElementHide(subgrid)) toIgnore.push(gridKey);
    else {
      visibleElements.subgrids[gridKey] = subgrid;
      visibleElements.positions.add(gridKey);
    }
  });
  stepElementTypes.forEach((type) => {
    if (type === 'subgrids') return;

    visibleElements[type] = step[type].filter((el: any) => {
      const elKey = getPositionKey(el);
      if (
        toIgnore.some((key: string) => elKey.startsWith(key)) ||
        shouldElementHide(el)
      ) {
        // Element or one of its parent containers is hidden
        visibleElements.positions.delete(elKey);
        return false;
      }

      if (shouldElementHide(el)) return false;
      else {
        visibleElements.positions.add(elKey);
        return true;
      }
    });
  });
  return visibleElements;
}

export {
  shouldElementHide,
  getHideIfReferences,
  getVisibleElements,
  stepElementTypes,
  getPositionKey
};
