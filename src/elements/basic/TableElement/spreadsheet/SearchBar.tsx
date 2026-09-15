import React from 'react';
import { TABLE_CLASS } from '../classNames';
import {
  searchBarStyle,
  searchButtonStyle,
  searchCountStyle,
  searchInputStyle
} from './styles';

export type SearchBarProps = {
  query: string;
  onQueryChange: (query: string) => void;
  matchCount: number;
  /** Index of the current match, or -1 when there is none. */
  cursor: number;
  onStep: (delta: 1 | -1) => void;
  onClose: () => void;
  /** Changes whenever the bar is asked to take focus again while open. */
  focusToken: number;
  /** Distance from the top of the spreadsheet box, so the bar clears the header. */
  top: number;
};

/**
 * The find toolbar that floats over the grid's top-right corner. Enter and
 * Shift+Enter step through the matches, Escape closes it, and Mod+F while it
 * is open reselects the query rather than reaching the browser's own find.
 */
export function SearchBar({
  query,
  onQueryChange,
  matchCount,
  cursor,
  onStep,
  onClose,
  focusToken,
  top
}: SearchBarProps) {
  const inputRef = React.useRef<HTMLInputElement>(null);

  React.useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, [focusToken]);

  const handleKeyDown = (event: React.KeyboardEvent<HTMLElement>) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      onStep(event.shiftKey ? -1 : 1);
    } else if (event.key === 'Escape') {
      event.preventDefault();
      onClose();
    } else if (
      (event.metaKey || event.ctrlKey) &&
      event.key.toLowerCase() === 'f'
    ) {
      event.preventDefault();
      inputRef.current?.select();
    }
  };

  const count = !query.trim()
    ? ''
    : matchCount
    ? `${cursor + 1} of ${matchCount}`
    : 'No matches';

  return (
    <div
      role='search'
      aria-label='Find in table'
      className={TABLE_CLASS.gridSearchBar}
      css={{ ...searchBarStyle, top: `${top}px` }}
      onKeyDown={handleKeyDown}
    >
      <input
        ref={inputRef}
        type='text'
        aria-label='Find in table'
        placeholder='Find'
        className={TABLE_CLASS.gridSearchInput}
        css={searchInputStyle}
        value={query}
        onChange={(event) => onQueryChange(event.target.value)}
      />
      <span
        className={TABLE_CLASS.gridSearchCount}
        css={searchCountStyle}
        aria-live='polite'
      >
        {count}
      </span>
      <button
        type='button'
        aria-label='Previous match'
        className={TABLE_CLASS.gridSearchStep}
        css={searchButtonStyle}
        disabled={!matchCount}
        onClick={() => onStep(-1)}
      >
        ↑
      </button>
      <button
        type='button'
        aria-label='Next match'
        className={TABLE_CLASS.gridSearchStep}
        css={searchButtonStyle}
        disabled={!matchCount}
        onClick={() => onStep(1)}
      >
        ↓
      </button>
      <button
        type='button'
        aria-label='Close find'
        className={TABLE_CLASS.gridSearchClose}
        css={searchButtonStyle}
        onClick={onClose}
      >
        ×
      </button>
    </div>
  );
}
