/**
 * ISO date format (`yyyy-MM-dd`) that Postgres accepts for `date` column
 * literals and comparisons. Shared across server actions and queries so the
 * wire format for date columns stays consistent and does not drift.
 */
export const DB_DATE_FORMAT = 'yyyy-MM-dd'
