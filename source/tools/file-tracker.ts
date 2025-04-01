import * as fs from 'fs/promises';
import * as path from 'path';

async function getModifiedTime(filePath: string): Promise<number> {
  try {
    const stat = await fs.stat(filePath);
    return stat.mtimeMs;
  } catch (e) {
    throw new Error(`Could not get modified time for ${filePath}: ${e}`);
  }
}

export class FileOutdatedError extends Error {
  readonly filePath: string;
  constructor(message: string, params: { path: string }) {
    super(message);
    this.name = this.constructor.name;
    this.filePath = params.path;
  }
}
export class FileExistsError extends Error {
  constructor(message: string) {
    super(message);
    this.name = this.constructor.name;
  }
}

export class FileTracker {
  private readTimestamps = new Map<string, number>();

  async read(filePath: string): Promise<string> {
    const absolutePath = path.resolve(filePath);
    const content = await fs.readFile(absolutePath, 'utf8');
    const modified = await getModifiedTime(absolutePath);
    this.readTimestamps.set(absolutePath, modified);
    return content;
  }

  async write(filePath: string, content: string): Promise<void> {
    const absolutePath = path.resolve(filePath);
    await fs.writeFile(absolutePath, content, 'utf8');
    // Use current timestamp after write
    this.readTimestamps.set(absolutePath, Date.now());
  }

  async canEdit(filePath: string): Promise<boolean> {
    const absolutePath = path.resolve(filePath);
    if (!this.readTimestamps.has(absolutePath)) return false;

    const lastReadTime = this.readTimestamps.get(absolutePath)!;
    const currentModified = await getModifiedTime(absolutePath);

    return currentModified <= lastReadTime;
  }

  async canCreate(filePath: string) {
    const absolutePath = path.resolve(filePath);
    try {
      await getModifiedTime(absolutePath);
      return false;
    } catch {
      return true;
    }
  }

  async assertCanCreate(filePath: string) {
    const canCreate = await this.canCreate(filePath);
    if(!canCreate) throw new FileExistsError("File already exists");
  }

  async assertCanEdit(filePath: string) {
    const canEdit = await this.canEdit(filePath);
    if (!canEdit) {
      throw new FileOutdatedError("File was modified or never read", {
        path: filePath,
      });
    }
  }
}

// Default instance for application use
export const fileTracker = new FileTracker();
