import { z } from "zod";

/**
 * Where the next page of a newest-first list starts: opaque to clients, which
 * pass back the `nextCursor` (or `nextBefore`) they were given. A bare
 * timestamp, the older format, is still accepted.
 */
export const pageCursorSchema = z
  .string()
  .regex(
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z(_[0-9a-f-]{36})?$/i,
    "Use the cursor from the previous page",
  );
