import * as path from "path";
import { Transport } from "../transports/transport-common.ts";

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

  async readUntracked(
    transport: Transport,
    signal: AbortSignal,
    filePath: string,
  ): Promise<string> {
    const absolutePath = await transport.resolvePath(signal, filePath);
    const content = await transport.readFile(signal, absolutePath);
    return content;
  }

  async read(transport: Transport, signal: AbortSignal, filePath: string): Promise<string> {
    const absolutePath = await transport.resolvePath(signal, filePath);
    const content = await transport.readFile(signal, absolutePath);
    const modified = await transport.modTime(signal, absolutePath);
    this.readTimestamps.set(absolutePath, modified);
    return content;
  }

  async write(
    transport: Transport,
    signal: AbortSignal,
    filePath: string,
    content: string,
  ): Promise<string> {
    const absolutePath = await transport.resolvePath(signal, filePath);
    const dir = path.dirname(absolutePath);
    await transport.mkdir(signal, dir);
    await transport.writeFile(signal, absolutePath, content);
    // Update mod time
    const modified = await transport.modTime(signal, absolutePath);
    this.readTimestamps.set(absolutePath, modified);
    return absolutePath;
  }

  async canEdit(transport: Transport, signal: AbortSignal, filePath: string): Promise<boolean> {
    const absolutePath = await transport.resolvePath(signal, filePath);
    if (!this.readTimestamps.has(absolutePath)) return false;

    const lastReadTime = this.readTimestamps.get(absolutePath)!;
    const currentModified = await transport.modTime(signal, absolutePath);

    return currentModified <= lastReadTime;
  }

  async canCreate(transport: Transport, signal: AbortSignal, filePath: string) {
    const absolutePath = await transport.resolvePath(signal, filePath);
    try {
      await transport.modTime(signal, absolutePath);
      return false;
    } catch {
      return true;
    }
  }

  async assertCanCreate(transport: Transport, signal: AbortSignal, filePath: string) {
    const canCreate = await this.canCreate(transport, signal, filePath);
    if (!canCreate) throw new FileExistsError("File already exists");
  }

  async assertCanEdit(transport: Transport, signal: AbortSignal, filePath: string) {
    const canEdit = await this.canEdit(transport, signal, filePath);
    if (!canEdit) {
      throw new FileOutdatedError("File was modified or never read", {
        path: filePath,
      });
    }
  }
}

// Default instance for application use
export const fileTracker = new FileTracker();
