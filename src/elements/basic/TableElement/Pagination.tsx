import {
  navStyle,
  navTextBoldStyle,
  navTextStyle,
  pageButtonActiveStyle,
  pageButtonNextStyle,
  pageButtonPrevStyle,
  pageButtonStyle,
  pageButtonDisabledStyle,
  pageButtonEllipsisStyle,
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
  return (
    <>
      {Array.from({ length: totalPages }, (_, i) => {
        // Show first page, last page, current page, and pages around current
        const showPage =
          i === 0 || i === totalPages - 1 || Math.abs(i - currentPage) <= 1;

        const showEllipsis =
          (i === 1 && currentPage > 2) ||
          (i === totalPages - 2 && currentPage < totalPages - 3);

        if (showEllipsis) {
          return (
            <li key={i}>
              <button
                type='button'
                disabled
                css={pageButtonEllipsisStyle as any}
              >
                ...
              </button>
            </li>
          );
        }

        if (!showPage) return null;

        const isActive = i === currentPage;
        return (
          <li key={i}>
            <button
              type='button'
              onClick={() => onPageChange(i)}
              aria-current={isActive ? 'page' : undefined}
              css={
                isActive
                  ? (pageButtonActiveStyle as any)
                  : (pageButtonStyle as any)
              }
            >
              {i + 1}
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
