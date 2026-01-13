import fs from "fs/promises";

export async function fileExists(path: string) {
  try {
    await fs.stat(path);
    return true;
  } catch {
    return false;
  }
}
