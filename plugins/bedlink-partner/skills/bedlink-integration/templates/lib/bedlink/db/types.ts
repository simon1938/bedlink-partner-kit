/**
 * The only thing the BedLink store needs from your database: run one
 * parameterised Postgres statement ($1, $2…) and return the rows.
 * Adapters: neon.ts (Neon HTTP, also fine under Drizzle), pg.ts, prisma.ts.
 */
export type SqlClient = {
  query<T = Record<string, unknown>>(text: string, params?: unknown[]): Promise<T[]>;
};
