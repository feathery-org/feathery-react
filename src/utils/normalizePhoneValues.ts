import { normalizePhoneNumber } from './phoneNumber';
import { phoneLib } from './validation';

/** Normalize known phone fields without changing hidden or unrelated values. */
export function normalizePhoneValues(
  values: Record<string, any>,
  servars: Map<string, any>,
  preserveCanonical = false,
  previousValues: Record<string, any> = {}
): Record<string, any> {
  return Object.fromEntries(
    Object.entries(values).map(([key, value]) => {
      const servar = servars.get(key);
      if (servar?.type !== 'phone_number') return [key, value];
      const previous = previousValues[key];
      const normalize = (entry: any) =>
        normalizePhoneNumber(
          entry,
          servar.metadata,
          phoneLib,
          preserveCanonical ||
            (Array.isArray(previous)
              ? previous.includes(entry)
              : previous === entry)
        );
      return [
        key,
        Array.isArray(value) ? value.map(normalize) : normalize(value)
      ];
    })
  );
}

export function phoneServarsFromSteps(steps: any): Map<string, any> {
  return new Map(
    Object.values(steps ?? {}).flatMap((step: any) =>
      (step.servar_fields ?? []).map((field: any) => [
        field.servar.key,
        field.servar
      ])
    )
  );
}
