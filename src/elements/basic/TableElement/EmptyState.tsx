import { emptyStateContainerStyle, emptyStateTextStyle } from './styles';

type EmptyStateProps = {
  hasSearchQuery: boolean;
};

export function EmptyState({ hasSearchQuery }: EmptyStateProps) {
  return (
    <div css={emptyStateContainerStyle}>
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
        {hasSearchQuery ? (
          // Search icon for no search results
          <path
            strokeLinecap='round'
            strokeLinejoin='round'
            d='M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z'
          />
        ) : (
          // Inbox icon for no data
          <path
            strokeLinecap='round'
            strokeLinejoin='round'
            d='M20 13V6a2 2 0 00-2-2H6a2 2 0 00-2 2v7m16 0v5a2 2 0 01-2 2H6a2 2 0 01-2-2v-5m16 0h-2.586a1 1 0 00-.707.293l-2.414 2.414a1 1 0 01-.707.293h-3.172a1 1 0 01-.707-.293l-2.414-2.414A1 1 0 006.586 13H4'
          />
        )}
      </svg>
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
