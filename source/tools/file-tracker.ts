import * as path from "path";
import { Transport } from "../libocto/transport.ts";
import { err, ok, type Result } from "../libocto/result.ts";

export class FileTracker {
  private readTimestamps = new Map<string, number>();

  async readUntracked(
    transport: Transport,
    signal: AbortSignal,
    filePath: string,
  ): Promise<Result<string, string>> {
    const resolved = await transport.resolvePath(signal, filePath);
    if (!resolved.success) return resolved;
    return transport.readFile(signal, resolved.data);
  }

  async read(
    transport: Transport,
    signal: AbortSignal,
    filePath: string,
  ): Promise<Result<string, string>> {
    const resolved = await transport.resolvePath(signal, filePath);
    if (!resolved.success) return resolved;
    const absolutePath = resolved.data;

    const content = await transport.readFile(signal, absolutePath);
    if (!content.success) return content;

    const modified = await transport.modTime(signal, absolutePath);
    if (!modified.success) return modified;

    this.readTimestamps.set(absolutePath, modified.data);
    return content;
  }

  async recordFileReadTimestamp(
    transport: Transport,
    signal: AbortSignal,
    filePath: string,
  ): Promise<Result<void, string>> {
    const resolved = await transport.resolvePath(signal, filePath);
    if (!resolved.success) return resolved;
    const absolutePath = resolved.data;

    const modified = await transport.modTime(signal, absolutePath);
    if (!modified.success) return modified;

    this.readTimestamps.set(absolutePath, modified.data);
    return ok(undefined);
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

    const dir = path.dirname(absolutePath);
    const made = await transport.mkdir(signal, dir);
    if (!made.success) return made;

    const written = await transport.writeFile(signal, absolutePath, content);
    if (!written.success) return written;

    // Update mod time
    const modified = await transport.modTime(signal, absolutePath);
    if (!modified.success) return modified;

    this.readTimestamps.set(absolutePath, modified.data);
    return ok(absolutePath);
  }

  async isOutdated(
    transport: Transport,
    signal: AbortSignal,
    filePath: string,
  ): Promise<Result<boolean, string>> {
    const resolved = await transport.resolvePath(signal, filePath);
    if (!resolved.success) return resolved;
    const absolutePath = resolved.data;

    if (!this.readTimestamps.has(absolutePath)) return ok(false);
    const lastReadTime = this.readTimestamps.get(absolutePath)!;

    const currentModified = await transport.modTime(signal, absolutePath);
    if (!currentModified.success) {
      // File was deleted or is otherwise inaccessible
      return ok(false);
    }
    return ok(currentModified.data > lastReadTime);
  }

  async canCreate(
    transport: Transport,
    signal: AbortSignal,
    filePath: string,
  ): Promise<Result<boolean, string>> {
    const resolved = await transport.resolvePath(signal, filePath);
    if (!resolved.success) return resolved;

    const exists = await transport.pathExists(signal, resolved.data);
    if (!exists.success) return exists;
    return ok(!exists.data);
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
