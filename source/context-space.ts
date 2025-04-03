import { tagged } from "./xml.ts";

const CONTEXT_SPACE_TAG = "context";
const FILE_TAG = "file";

type FileContext = {
  absolutePath: string,
  content: string,
  historyId: bigint,
};

export class ContextSpace {
  private pathToFile = new Map<string, FileContext>();
  private files: FileContext[] = [];

  trackFile(f: FileContext) {
    // If there's an existing file with the same abs path, delete it
    const existing = this.pathToFile.get(f.absolutePath);
    if(existing) {
      const index = this.files.findIndex(e => e.absolutePath === f.absolutePath);
      if(index < 0) {
        throw new Error("File context out of sync: pathToFile found but no matching file");
      }
      this.files.splice(index, 1);
    }

    // Push and overwrite
    this.files.push(f);
    this.pathToFile.set(f.absolutePath, f);
  }

  window(minHistoryId: bigint) {
    this.files = this.files.filter(f => f.historyId >= minHistoryId);
    this.pathToFile = new Map();
    for(const f of this.files) {
      this.pathToFile.set(f.absolutePath, f);
    }
  }

  toXML() {
    if(this.files.length === 0) return "";

    const orderedFiles = this.files.concat([]).sort((a, b) => {
      if(a.historyId < b.historyId) return -1;
      if(b.historyId < a.historyId) return 1;
      return 0;
    });

    return tagged(CONTEXT_SPACE_TAG, {}, `
This is a system-generated message.
You have the following files open:
${orderedFiles.map(f => {
  return tagged(FILE_TAG, { absolutePath: f.absolutePath }, f.content);
}).join("\n")}
These files will be auto-closed when they're no longer relevant.
    `.trim());
  }
}
