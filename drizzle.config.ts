import type { Config } from "drizzle-kit";

export default {
  schema: "./source/db/schema.ts",
  out: "./drizzle",
  dialect: "sqlite",
  casing: "snake_case",
} satisfies Config;
