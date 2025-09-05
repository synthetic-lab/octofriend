import { beforeAll } from "vitest";
import { migrate } from "../db/migrate.ts";

beforeAll(async () => {
  await migrate();
});