import { Pool } from "pg";
import type { SqlClient } from "./types";

// node-postgres. If the app already exports a Pool, import it instead.
let pool: Pool | null = null;

export const db: SqlClient = {
  async query<T>(text: string, params: unknown[] = []) {
    pool ??= new Pool({ connectionString: process.env.DATABASE_URL, max: 3 });
    return (await pool.query(text, params)).rows as T[];
  },
};
