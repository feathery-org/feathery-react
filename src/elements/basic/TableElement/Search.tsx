import {
  searchContainerStyle,
  searchIconWrapperStyle,
  searchIconStyle,
  searchInputStyle,
  searchWrapperStyle
} from './styles';

function SearchIcon() {
  return (
    <svg
      css={searchIconStyle}
      fill='none'
      viewBox='0 0 24 24'
      stroke='currentColor'
      strokeWidth={2}
    >
      <path
        strokeLinecap='round'
        d='M21 21l-3.5-3.5M17 10a7 7 0 1 1-14 0 7 7 0 0 1 14 0Z'
      />
    </svg>
  );
}

type SearchProps = {
  searchQuery: string;
  onSearchChange: (query: string) => void;
};

export function Search({ searchQuery, onSearchChange }: SearchProps) {
  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
    }
  };

  return (
    <div css={searchContainerStyle}>
      <div css={searchWrapperStyle as any}>
        <div css={searchIconWrapperStyle as any}>
          <SearchIcon />
        </div>
        <input
          type='text'
          css={searchInputStyle}
          placeholder='Search'
          value={searchQuery}
          onChange={(e) => onSearchChange(e.target.value)}
          onKeyDown={handleKeyDown}
        />
      </div>
    </div>
  );
}
