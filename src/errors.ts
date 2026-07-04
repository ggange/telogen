/**
 * Expected, user-actionable failures (not a Next.js project, refused
 * overwrite, bad flags). Printed as a plain message with exit 1 — never
 * routed to the pre-filled GitHub issue URL, which is reserved for bugs.
 */
export class KnownError extends Error {}

/** CLI misuse (unknown flags). Same handling as KnownError, distinct type. */
export class UsageError extends KnownError {}
