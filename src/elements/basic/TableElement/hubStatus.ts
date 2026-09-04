/**
 * The Data Hub status column: a read-only first column that says whether each
 * row is verified data or a staged (unverified) row awaiting review.
 *
 * It is not a hub field, so it has a reserved id that can never collide with
 * one. The designer's column configuration lists it under that id, which is
 * how the normal hide control applies to it.
 */
export const STATUS_HUB_FIELD_ID = '__status__';
export const STATUS_HUB_FIELD_KEY = '__status__';
export const STATUS_COLUMN_NAME = 'Status';

export const STATUS_LABEL_VERIFIED = 'Verified';
export const STATUS_LABEL_UNVERIFIED = 'Unverified';

export const statusLabel = (verified: boolean) =>
  verified ? STATUS_LABEL_VERIFIED : STATUS_LABEL_UNVERIFIED;
