import fs from "fs/promises";
import os from "os";
import path from "path";

export async function temporaryDirectory() {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "octo-demo-"));
  return {
    path: directory,
    [Symbol.asyncDispose]: () => fs.rm(directory, { recursive: true, force: true }),
  };
}
