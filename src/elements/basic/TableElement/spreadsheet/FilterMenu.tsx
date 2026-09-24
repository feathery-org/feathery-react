import React from 'react';
import { TABLE_CLASS } from '../classNames';
import {
  BLANK_LABEL,
  MAX_LISTED_VALUES,
  searchedValues,
  setValuesChecked
} from './columnFilters';
import { useAnchoredPopover } from './ContextMenu';
import type { HeaderMenuTarget } from './HeaderMenu';
import {
  filterButtonStyle,
  filterCheckboxStyle,
  filterFooterStyle,
  filterListStyle,
  filterMenuStyle,
  filterNoteStyle,
  filterOptionLabelStyle,
  filterOptionStyle,
  filterSearchInputStyle
} from './styles';
import type { SpreadsheetFilters } from './useColumnFilters';

type FilterMenuProps = {
  target: HeaderMenuTarget;
  filters: SpreadsheetFilters;
  onClose: () => void;
};

/**
 * A column's filter popover, opened from the header menu: a search box that
 * narrows the column to values containing the text, over a checklist of the
 * column's values. Every change applies to the grid as it is made.
 */
export function FilterMenu({ target, filters, onClose }: FilterMenuProps) {
  const ref = React.useRef<HTMLDivElement>(null);
  const position = useAnchoredPopover(ref, target.x, target.y, onClose);

  const inputRef = React.useRef<HTMLInputElement>(null);
  React.useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const { fieldKey, name } = target;
  const filter = filters.get(fieldKey);
  const candidates = React.useMemo(
    () => filters.candidates(fieldKey),
    [filters, fieldKey]
  );
  // The search narrows what is shown; the checks below act on `searched`,
  // but seed from `candidates` so the hidden values keep their state.
  const searched = searchedValues(candidates, filter);
  const listed = searched.slice(0, MAX_LISTED_VALUES);
  const unlisted = searched.length - listed.length;

  const isChecked = (value: string) =>
    filter.values === null || filter.values.has(value);
  const checkedCount = searched.filter(isChecked).length;
  const allChecked = searched.length > 0 && checkedCount === searched.length;
  const setChecked = (values: string[], checked: boolean) =>
    filters.set(
      fieldKey,
      setValuesChecked(filter, candidates, values, checked)
    );

  // A partly checked list shows as indeterminate, which only the DOM can set.
  const selectAllRef = React.useRef<HTMLInputElement>(null);
  React.useEffect(() => {
    if (selectAllRef.current) {
      selectAllRef.current.indeterminate = checkedCount > 0 && !allChecked;
    }
  }, [checkedCount, allChecked]);

  return (
    <div
      ref={ref}
      role='dialog'
      aria-label={`Filter column ${name}`}
      className={TABLE_CLASS.gridFilterMenu}
      css={{ ...filterMenuStyle, left: position.x, top: position.y }}
    >
      <input
        ref={inputRef}
        type='text'
        aria-label={`Search ${name} values`}
        placeholder='Search values'
        className={TABLE_CLASS.gridFilterSearch}
        css={filterSearchInputStyle}
        value={filter.search}
        onChange={(event) =>
          filters.set(fieldKey, { ...filter, search: event.target.value })
        }
      />
      <div css={filterListStyle}>
        {searched.length ? (
          <label
            className={TABLE_CLASS.gridFilterOption}
            css={filterOptionStyle}
          >
            <input
              ref={selectAllRef}
              type='checkbox'
              css={filterCheckboxStyle}
              checked={allChecked}
              onChange={(event) => setChecked(searched, event.target.checked)}
            />
            <span css={filterOptionLabelStyle(false)}>(Select all)</span>
          </label>
        ) : (
          <div css={filterNoteStyle}>No matching values</div>
        )}
        {listed.map((value) => (
          <label
            key={value}
            className={TABLE_CLASS.gridFilterOption}
            css={filterOptionStyle}
          >
            <input
              type='checkbox'
              css={filterCheckboxStyle}
              checked={isChecked(value)}
              onChange={(event) => setChecked([value], event.target.checked)}
            />
            <span css={filterOptionLabelStyle(value === '')} title={value}>
              {value || BLANK_LABEL}
            </span>
          </label>
        ))}
        {unlisted > 0 ? (
          <div css={filterNoteStyle}>
            {unlisted} more values. Search to narrow the list.
          </div>
        ) : null}
      </div>
      <div css={filterFooterStyle}>
        <button
          type='button'
          className={TABLE_CLASS.gridFilterAction}
          css={filterButtonStyle}
          disabled={!filters.isFiltered(fieldKey)}
          onClick={() => {
            filters.clear(fieldKey);
            onClose();
          }}
        >
          Clear filter
        </button>
        <button
          type='button'
          className={TABLE_CLASS.gridFilterAction}
          css={filterButtonStyle}
          onClick={onClose}
        >
          Done
        </button>
      </div>
    </div>
  );
}
