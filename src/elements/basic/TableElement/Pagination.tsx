import {
  navStyle,
  navTextBoldStyle,
  navTextStyle,
  pageButtonActiveStyle,
  pageButtonNextStyle,
  pageButtonPrevStyle,
  pageButtonStyle,
  pageButtonDisabledStyle,
  overflowSelectStyle,
  paginationListStyle
} from './styles';

type PaginationProps = {
  currentPage: number;
  totalPages: number;
  totalItems: number;
  rowsPerPage: number;
  onPageChange: (page: number) => void;
};

type PageInfoProps = Pick<
  PaginationProps,
  'currentPage' | 'totalItems' | 'rowsPerPage'
>;

// ex. Showing 1-10 of 30
function PageInfo({ currentPage, totalItems, rowsPerPage }: PageInfoProps) {
  return (
    <span css={navTextStyle}>
      Showing{' '}
      <span css={navTextBoldStyle}>
        {currentPage * rowsPerPage + 1}-
        {Math.min((currentPage + 1) * rowsPerPage, totalItems)}
      </span>{' '}
      of <span css={navTextBoldStyle}>{totalItems}</span>
    </span>
  );
}

type PreviousButtonProps = {
  disabled: boolean;
  onClick: () => void;
};

function PreviousButton({ disabled, onClick }: PreviousButtonProps) {
  return (
    <button
      type='button'
      onClick={onClick}
      disabled={disabled}
      css={{
        ...(pageButtonPrevStyle as any),
        ...(disabled ? pageButtonDisabledStyle : {})
      }}
    >
      Previous
    </button>
  );
}

type NextButtonProps = {
  disabled: boolean;
  onClick: () => void;
};

function NextButton({ disabled, onClick }: NextButtonProps) {
  return (
    <button
      type='button'
      onClick={onClick}
      disabled={disabled}
      css={{
        ...(pageButtonNextStyle as any),
        ...(disabled ? pageButtonDisabledStyle : {})
      }}
    >
      Next
    </button>
  );
}

type OverflowSelectProps = {
  pages: number[];
  onPageChange: (page: number) => void;
};

function OverflowSelect({ pages, onPageChange }: OverflowSelectProps) {
  return (
    <select
      value=''
      onChange={(e) => {
        onPageChange(Number(e.target.value));
      }}
      aria-label='Go to page'
      css={overflowSelectStyle as any}
    >
      <option value='' disabled hidden>
        ...
      </option>
      {pages.map((page) => (
        <option key={page} value={page}>
          {page + 1}
        </option>
      ))}
    </select>
  );
}

type PageNumbersProps = {
  currentPage: number;
  totalPages: number;
  onPageChange: (page: number) => void;
};

function PageNumbers({
  currentPage,
  totalPages,
  onPageChange
}: PageNumbersProps) {
  const visiblePages = new Set<number>();
  visiblePages.add(0);
  visiblePages.add(totalPages - 1);
  for (
    let i = Math.max(0, currentPage - 1);
    i <= Math.min(totalPages - 1, currentPage + 1);
    i++
  ) {
    visiblePages.add(i);
  }

  const items: Array<
    { type: 'page'; page: number } | { type: 'overflow'; pages: number[] }
  > = [];
  const sortedVisible = Array.from(visiblePages).sort((a, b) => a - b);

  for (let i = 0; i < sortedVisible.length; i++) {
    const page = sortedVisible[i];
    const prevPage = i > 0 ? sortedVisible[i - 1] : -1;

    if (page - prevPage > 1) {
      const hiddenPages: number[] = [];
      for (let j = prevPage + 1; j < page; j++) {
        hiddenPages.push(j);
      }
      items.push({ type: 'overflow', pages: hiddenPages });
    }

    items.push({ type: 'page', page });
  }

  return (
    <>
      {items.map((item, idx) => {
        if (item.type === 'overflow') {
          if (item.pages.length === 1) {
            return (
              <li key={`overflow-${idx}`}>
                <button
                  type='button'
                  onClick={() => onPageChange(item.pages[0])}
                  css={pageButtonStyle as any}
                >
                  {item.pages[0] + 1}
                </button>
              </li>
            );
          }
          return (
            <li key={`overflow-${idx}`}>
              <OverflowSelect pages={item.pages} onPageChange={onPageChange} />
            </li>
          );
        }

        const isActive = item.page === currentPage;
        return (
          <li key={item.page}>
            <button
              type='button'
              onClick={() => onPageChange(item.page)}
              aria-current={isActive ? 'page' : undefined}
              css={
                isActive
                  ? (pageButtonActiveStyle as any)
                  : (pageButtonStyle as any)
              }
            >
              {item.page + 1}
            </button>
          </li>
        );
      })}
    </>
  );
}

export function Pagination({
  currentPage,
  totalPages,
  totalItems,
  rowsPerPage,
  onPageChange
}: PaginationProps) {
  if (totalPages <= 1) return null;

  return (
    <nav css={navStyle as any} aria-label='Table navigation'>
      <PageInfo
        currentPage={currentPage}
        totalItems={totalItems}
        rowsPerPage={rowsPerPage}
      />
      <ul css={paginationListStyle}>
        <li>
          <PreviousButton
            disabled={currentPage === 0}
            onClick={() => onPageChange(Math.max(0, currentPage - 1))}
          />
        </li>
        <PageNumbers
          currentPage={currentPage}
          totalPages={totalPages}
          onPageChange={onPageChange}
        />
        <li>
          <NextButton
            disabled={currentPage >= totalPages - 1}
            onClick={() => {
              onPageChange(Math.min(totalPages - 1, currentPage + 1));
            }}
          />
        </li>
      </ul>
    </nav>
  );
}
