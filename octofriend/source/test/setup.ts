import { beforeAll } from "bun:test";
import { migrate } from "../db/migrate.ts";

beforeAll(async () => {
  await migrate();
});
