// Merge into the project's existing vercel.ts (do not replace it).
import type { VercelConfig } from "@vercel/config/v1";

export const config: VercelConfig = {
  crons: [{ path: "/api/bedlink/cron", schedule: "*/10 * * * *" }],
};
