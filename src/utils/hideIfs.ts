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
function shouldElementHide({ element }: { element: any }) {
  const reshapedHideIfs = reshapeHideIfs(element.hide_ifs ?? []);

  return reshapedHideIfs.some((hideIfRules: ResolvedComparisonRule[]) =>
    hideIfRules.every((rule) => evalComparisonRule(rule, element.repeat))
  );
}

export { shouldElementHide, getHideIfReferences };
