import type { Config } from "drizzle-kit";

export default {
  schema: "./source/**/schema/*.ts",
  out: "./drizzle",
  dialect: "sqlite",
} satisfies Config;
