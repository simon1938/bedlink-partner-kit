import { neon } from "@neondatabase/serverless";
import type { SqlClient } from "./types";

// Neon over HTTP. Works whether the rest of the app uses Drizzle, Prisma or
// raw SQL: the BedLink tables are plain Postgres tables.
// Use the pooled or direct DATABASE_URL your project already has.
let sql: ReturnType<typeof neon> | null = null;

export const db: SqlClient = {
  async query<T>(text: string, params: unknown[] = []) {
    sql ??= neon(process.env.DATABASE_URL!);
    return (await sql.query(text, params)) as T[];
  },
};
