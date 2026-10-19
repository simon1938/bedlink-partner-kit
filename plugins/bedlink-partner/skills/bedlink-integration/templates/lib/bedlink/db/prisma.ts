import type { SqlClient } from "./types";

// Prisma: reuse the app's PrismaClient singleton. Adjust the import path to
// wherever the project exports it (often "@/lib/prisma" or "@/lib/db").
// Works with Prisma 5, 6 and 7 (custom client output): only $queryRawUnsafe is used.
import { prisma } from "@/lib/prisma";

type RawCapable = { $queryRawUnsafe(query: string, ...values: unknown[]): Promise<unknown> };
const client = prisma as unknown as RawCapable;

export const db: SqlClient = {
  async query<T>(text: string, params: unknown[] = []) {
    // Parameters are bound by Prisma ($1, $2…), never concatenated.
    return (await client.$queryRawUnsafe(text, ...params)) as T[];
  },
};
