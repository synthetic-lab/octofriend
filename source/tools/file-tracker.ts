import * as path from "path";
import { Transport } from "../transports/transport-common.ts";
import { attempt, err, ok, type Result } from "../libocto/result.ts";

export class FileTracker {
  private readTimestamps = new Map<string, number>();

  async readUntracked(
    transport: Transport,
    signal: AbortSignal,
    filePath: string,
  ): Promise<Result<string, string>> {
    const resolved = await transport.resolvePath(signal, filePath);
    if (!resolved.success) return resolved;
    const absolutePath = resolved.data;
    return attempt(`Could not read file ${filePath}`, async () => {
      return transport.readFile(signal, absolutePath);
    });
  }

  async read(
    transport: Transport,
    signal: AbortSignal,
    filePath: string,
  ): Promise<Result<string, string>> {
    const resolved = await transport.resolvePath(signal, filePath);
    if (!resolved.success) return resolved;
    const absolutePath = resolved.data;
    return attempt(`Could not read file ${filePath}`, async () => {
      const content = await transport.readFile(signal, absolutePath);
      const modified = await transport.modTime(signal, absolutePath);
      this.readTimestamps.set(absolutePath, modified);
      return content;
    });
  }

  async recordFileReadTimestamp(
    transport: Transport,
    signal: AbortSignal,
    filePath: string,
  ): Promise<Result<void, string>> {
    const resolved = await transport.resolvePath(signal, filePath);
    if (!resolved.success) return resolved;
    const absolutePath = resolved.data;
    return attempt(`Could not record read timestamp for ${filePath}`, async () => {
      const modified = await transport.modTime(signal, absolutePath);
      this.readTimestamps.set(absolutePath, modified);
    });
  }

  async write(
    transport: Transport,
    signal: AbortSignal,
    filePath: string,
    content: string,
  ): Promise<Result<string, string>> {
    const resolved = await transport.resolvePath(signal, filePath);
    if (!resolved.success) return resolved;
    const absolutePath = resolved.data;
    return attempt(`Failed to write file ${filePath}`, async () => {
      const dir = path.dirname(absolutePath);
      await transport.mkdir(signal, dir);
      await transport.writeFile(signal, absolutePath, content);
      // Update mod time
      const modified = await transport.modTime(signal, absolutePath);
      this.readTimestamps.set(absolutePath, modified);
      return absolutePath;
    });
  }

  async isOutdated(
    transport: Transport,
    signal: AbortSignal,
    filePath: string,
  ): Promise<Result<boolean, string>> {
    const resolved = await transport.resolvePath(signal, filePath);
    if (!resolved.success) return resolved;
    const absolutePath = resolved.data;
    return attempt(`Could not check file ${filePath} for changes`, async () => {
      if (!this.readTimestamps.has(absolutePath)) return false;

      const lastReadTime = this.readTimestamps.get(absolutePath)!;
      try {
        const currentModified = await transport.modTime(signal, absolutePath);
        return currentModified > lastReadTime;
      } catch {
        // File was deleted or is otherwise inaccessible
        return false;
      }
    });
  }

  async canCreate(
    transport: Transport,
    signal: AbortSignal,
    filePath: string,
  ): Promise<Result<boolean, string>> {
    const resolved = await transport.resolvePath(signal, filePath);
    if (!resolved.success) return resolved;
    const absolutePath = resolved.data;
    return attempt(`Could not check whether file ${filePath} can be created`, async () => {
      try {
        await transport.modTime(signal, absolutePath);
        return false;
      } catch {
        return true;
      }
    });
  }

  async assertCanCreate(
    transport: Transport,
    signal: AbortSignal,
    filePath: string,
  ): Promise<Result<null, string>> {
    const canCreate = await this.canCreate(transport, signal, filePath);
    if (!canCreate.success) return canCreate;
    return canCreate.data ? ok(null) : err("File already exists");
  }
}

// Default instance for application use
export const fileTracker = new FileTracker();
