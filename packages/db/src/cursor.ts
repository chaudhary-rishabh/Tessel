import { desc, sql, type AnyColumn, type SQL } from "drizzle-orm";

/**
 * Keyset paging for lists ordered newest first by a timestamp. Postgres keeps
 * microseconds but a JavaScript Date keeps milliseconds, so the timestamp is
 * compared at millisecond precision, with the row's ID breaking ties. That way
 * rows that share a millisecond are never skipped between pages.
 */
export interface PageCursor {
  at: Date;
  id: string;
}

const SEPARATOR = "_";
// Older cursors were a bare timestamp; they continue from the end of that millisecond.
const LAST_ID = "ffffffff-ffff-ffff-ffff-ffffffffffff";

export function encodeCursor(at: Date, id: string): string {
  return `${at.toISOString()}${SEPARATOR}${id}`;
}

export function decodeCursor(cursor: string): PageCursor {
  const [at = "", id = LAST_ID] = cursor.split(SEPARATOR);
  return { at: new Date(at), id };
}

const toMillis = (column: AnyColumn) => sql`date_trunc('milliseconds', ${column})`;

/** Rows after the cursor, in newest-first order. */
export function olderThan(column: AnyColumn, idColumn: AnyColumn, cursor: string): SQL {
  const { at, id } = decodeCursor(cursor);
  return sql`(${toMillis(column)}, ${idColumn}) < (${at.toISOString()}::timestamptz, ${id}::uuid)`;
}

/** Newest first, with the ID as the tie-break that `olderThan` relies on. */
export function newestFirst(column: AnyColumn, idColumn: AnyColumn): SQL[] {
  return [desc(toMillis(column)), desc(idColumn)];
}

/** Escapes `%`, `_` and `\` so a LIKE pattern matches them literally. */
export function escapeLike(text: string): string {
  return text.replace(/[\\%_]/g, (character) => `\\${character}`);
}
