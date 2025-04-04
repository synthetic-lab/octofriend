import { tagged } from "./xml.ts";
import * as fs from "fs/promises";
import { fileTracker } from "./tools/file-tracker.ts";

const CONTEXT_SPACE_TAG = "context";
const FILE_TAG = "file";
const DIR_TAG = "dir";
const PLAN_TAG = "plan";

type TrackedContext = {
  absolutePath: string,
  historyId: bigint,
};

export class SequencedPathTracker {
  private pathToItem = new Map<string, TrackedContext>();
  private items: TrackedContext[] = [];
  private permanentItems = new Map<string, Omit<TrackedContext, "historyId">>();
  constructor(
    private readonly _toXML: (tracker: SequencedPathTracker) => Promise<string>
  ) {}

  track(item: TrackedContext) {
    // If there's an existing file with the same abs path, delete it
    const existing = this.pathToItem.get(item.absolutePath);
    if(existing) {
      const index = this.items.findIndex(e => e.absolutePath === item.absolutePath);
      if(index < 0) {
        throw new Error("Context out of sync: pathToItem found but no matching item");
      }
      this.items.splice(index, 1);
    }

    // Push and overwrite
    this.items.push(item);
    this.pathToItem.set(item.absolutePath, item);
  }

  permaTrack(item: Omit<TrackedContext, "historyId">) {
    this.permanentItems.set(item.absolutePath, item);
  }

  window(minHistoryId: bigint) {
    this.items = this.items.filter(item => item.historyId >= minHistoryId);
    this.pathToItem = new Map();
    for(const item of this.items) {
      this.pathToItem.set(item.absolutePath, item);
    }
  }

  orderedItems() {
    return Array.from(this.permanentItems.values()).concat(this.items.concat([]).sort((a, b) => {
      if(a.historyId < b.historyId) return -1;
      if(b.historyId < a.historyId) return 1;
      return 0;
    }));
  }

  async toXML() {
    if(this.items.length === 0 && this.permanentItems.size === 0) return "";
    return await this._toXML(this);
  }
}


export class ArrayTracker<T> {
  private array: T[] = [];

  constructor(
    private readonly _toXML: (kv: ArrayTracker<T>) => Promise<string>,
  ) {}

  push(value: T) {
    this.array.push(value);
  }

  remove(index: number) {
    this.array.splice(index, 1);
  }

  clear() {
    this.array = [];
  }

  window() {
  }

  items() {
    return this.array.concat([]);
  }

  async toXML() {
    if(this.array.length === 0) return "";
    return this._toXML(this);
  }
}

export class ContextSpaceBuilder<T extends {
  [key: string]: SequencedPathTracker | ArrayTracker<any>
}> {
  constructor(
    private readonly defn: T
  ) {}

  tracker<K extends keyof T>(k: K): T[K] {
    return this.defn[k];
  }

  window(minHistoryId: bigint) {
    for(const tracker of Object.values(this.defn)) {
      tracker.window(minHistoryId);
    }
  }

  async toXML() {
    const xml = await Promise.all(Object.values(this.defn).map(t => t.toXML()));
    const nonempty = xml.filter(s => s !== "");
    if(nonempty.length === 0) return "";
    return tagged(CONTEXT_SPACE_TAG, {}, `
This is a system-generated message.
${nonempty.join("\n\n")}
    `.trim());
  }
}

export function contextSpace() {
  return new ContextSpaceBuilder({
    plan: new ArrayTracker<string>(async (kv) => {
      return tagged(PLAN_TAG, {}, `
You have previously decided on a plan:
${kv.items().map((step, index) => {
  return `Step number ${index}: ${step}`;
}).join("\n")}
You should update the plan if you've completed a step, or if the plan needs to be updated.
If the plan is done, clear it out (or overwrite it by setting a new plan if appropriate).
`.trim());
    }),

    files: new SequencedPathTracker(async (f) => {
      const files = await Promise.all(f.orderedItems().map(async (f) => {
        try {
          return {
            absolutePath: f.absolutePath,
            content: await fileTracker.read(f.absolutePath),
          };
        } catch {
          return null;
        }
      }));
      const existingFiles = files.filter(f => f !== null);
      return `
You have the following files open:
${existingFiles.map(f => tagged(FILE_TAG, { filePath: f.absolutePath }, f.content)).join("\n")}
These files will be auto-closed when they're no longer relevant.
You don't need to re-read these files: they're automatically kept up-to-date with the current state
on disk.
      `.trim();
    }),
    dirs: new SequencedPathTracker(async (d) => {
      const dirs = await Promise.all(d.orderedItems().map(async (dc) => {
        try {
          return {
            dir: dc.absolutePath,
            entries: await fs.readdir(dc.absolutePath, {
              withFileTypes: true,
            }),
          };
        } catch {
          return null;
        }
      }));
      const existingDirs = dirs.filter(d => d !== null);
      return `
You can observe the following directory layouts:
${existingDirs.map(d => {
  return tagged(DIR_TAG, { dirPath: d.dir }, existingDirs.map(e => JSON.stringify(e)).join("\n"));
})}
There may be other directories on the system, but you haven't listed them yet.
`.trim();
    }),
  });
}

export type ContextSpace = ReturnType<typeof contextSpace>;
