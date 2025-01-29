import { useMemo } from 'react';
import baseLocale from 'date-fns/locale/en-US';
import { Locale } from 'date-fns';

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
      // Validate month and weekday names if provided
      if (monthNames && monthNames.length !== 12) {
        console.error(
          'Could not load translation:',
          'Month translation must contain exactly 12 months'
        );
        return baseLocale;
      }
      if (shortDayNames && shortDayNames.length !== 7) {
        console.error(
          'Could not load translation:',
          'Weekday translation must contain exactly 7 days'
        );
        return baseLocale;
      }

      return {
        ...baseLocale,
        localize: {
          ...baseLocale.localize,
          month: (n: number, options: LocalizeOptions = {}) => {
            if (!monthNames) {
              return baseLocale.localize?.month(n, options);
            }

            const { width } = options;
            if (!width || width === 'wide') {
              return monthNames[n];
            }

            return baseLocale.localize?.month(n, options);
          },
          day: (n: number, options: LocalizeOptions = {}) => {
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
      return baseLocale;
    }
  }, [monthNames, shortDayNames]);

  return customLocale as Locale;
};
