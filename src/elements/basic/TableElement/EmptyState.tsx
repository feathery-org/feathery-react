import { emptyStateContainerStyle, emptyStateTextStyle } from './styles';

type EmptyStateProps = {
  hasSearchQuery: boolean;
};

export function EmptyState({ hasSearchQuery }: EmptyStateProps) {
  return (
    <div css={emptyStateContainerStyle}>
      {hasSearchQuery && (
        <svg
          css={{
            width: '48px',
            height: '48px',
            color: '#9ca3af',
            marginBottom: '16px'
          }}
          fill='none'
          viewBox='0 0 24 24'
          stroke='currentColor'
          strokeWidth={1.5}
        >
          <path
            strokeLinecap='round'
            strokeLinejoin='round'
            d='M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z'
          />
        </svg>
      )}
      <p css={emptyStateTextStyle}>
        {hasSearchQuery ? 'No results found' : 'No data available'}
      </p>
      {hasSearchQuery && (
        <p css={{ ...emptyStateTextStyle, fontSize: '14px', marginTop: '8px' }}>
          Try adjusting your search query
        </p>
      )}
    </div>
  );
}
