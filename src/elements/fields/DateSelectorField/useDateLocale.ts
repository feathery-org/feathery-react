import { useMemo } from 'react';
import { enUS as baseLocale } from 'date-fns/locale';
import type { Day, Locale, Month } from 'date-fns';

interface UseCustomDateLocaleProps {
  monthNames?: string[] | null;
  shortDayNames?: string[] | null;
}

type LocalizeOptions = {
  width?: 'narrow' | 'abbreviated' | 'wide' | 'short';
  context?: 'formatting' | 'standalone';
};

// Creates a custom date-fns locale that allows react-datepicker to render
// custom names for months and weekdays
//
// It only overwrites month long names and short weekday names as those are
// what the datepicker uses. The rest is copied from en-US locale
export const useCustomDateLocale = ({
  monthNames,
  shortDayNames
}: UseCustomDateLocaleProps = {}): Locale => {
  const customLocale = useMemo(() => {
    try {
      if (!baseLocale || !baseLocale.localize) {
        console.warn(
          'Could not load translation: Base locale could not be loaded'
        );
        return undefined;
      }
      // Validate month and weekday names if provided
      if (monthNames && monthNames.length !== 12) {
        console.warn(
          'Could not load translation: Month translation must contain exactly 12 months'
        );
        return baseLocale;
      }
      if (shortDayNames && shortDayNames.length !== 7) {
        console.warn(
          'Could not load translation: Weekday translation must contain exactly 7 days'
        );
        return baseLocale;
      }

      return {
        ...baseLocale,
        localize: {
          ...baseLocale.localize,
          month: (n: Month, options: LocalizeOptions = {}) => {
            if (!monthNames) {
              return baseLocale.localize?.month(n, options);
            }

            const { width } = options;
            if (!width || width === 'wide') {
              return monthNames[n];
            }

            return baseLocale.localize?.month(n, options);
          },
          day: (n: Day, options: LocalizeOptions = {}) => {
            if (!shortDayNames) {
              return baseLocale.localize?.day(n, options);
            }

            const { width } = options;
            if (!width || width === 'short') {
              return shortDayNames[n];
            }

            return baseLocale.localize?.day(n, options);
          }
        }
      };
    } catch (err) {
      console.error('Could not load translation:', err);
      return undefined;
    }
  }, [monthNames, shortDayNames]);

  return customLocale as Locale;
};
