import fs from "fs/promises";
import { t } from "structural";
import { fileExists } from "./fs-utils.ts";
import { DATA_DIR, INPUT_HISTORY_FILE } from "./config.ts";

const InputHistorySchema = t.subtype({
  history: t.array(t.str),
});

type InputHistoryData = t.GetType<typeof InputHistorySchema>;

const MAX_HISTORY_ITEMS = 100;

let cachedHistory: string[] | null = null;

export async function loadInputHistory(): Promise<string[]> {
  if (cachedHistory !== null) {
    return cachedHistory;
  }

  try {
    if (await fileExists(INPUT_HISTORY_FILE)) {
      const content = await fs.readFile(INPUT_HISTORY_FILE, "utf8");
      const data = InputHistorySchema.slice(JSON.parse(content));
      cachedHistory = data.history;
      return cachedHistory;
    }
  } catch (error) {
    console.warn("Failed to load input history:", error);
  }

  cachedHistory = [];
  return cachedHistory;
}

export async function saveInputHistory(history: string[]): Promise<void> {
  try {
    await fs.mkdir(DATA_DIR, { recursive: true });

    const data: InputHistoryData = {
      history: history.slice(-MAX_HISTORY_ITEMS), // Keep only the last MAX_HISTORY_ITEMS
    };

    await fs.writeFile(INPUT_HISTORY_FILE, JSON.stringify(data, null, 2), "utf8");
    cachedHistory = data.history;
  } catch (error) {
    console.warn("Failed to save input history:", error);
  }
}

export async function addToInputHistory(input: string): Promise<void> {
  if (!input.trim()) return; // Don't save empty inputs

  const history = await loadInputHistory();
  await saveInputHistory([...history, input]);
}

export class InputHistoryNavigator {
  private history: string[] = [];
  private currentIndex: number = -1;
  private originalInput: string = "";

  constructor() {
    this.loadHistory();
  }

  private async loadHistory(): Promise<void> {
    this.history = await loadInputHistory();
    this.currentIndex = -1;
  }

  public setCurrentInput(input: string): void {
    if (this.currentIndex === -1) {
      this.originalInput = input;
    }
  }

  public navigateUp(): string | null {
    if (this.history.length === 0) return null;

    if (this.currentIndex === -1) {
      this.currentIndex = this.history.length - 1;
    } else if (this.currentIndex > 0) {
      this.currentIndex--;
    }

    return this.history[this.currentIndex];
  }

  public navigateDown(): string | null {
    if (this.currentIndex === -1 || this.history.length === 0) {
      return null;
    }

    if (this.currentIndex < this.history.length - 1) {
      this.currentIndex++;
      return this.history[this.currentIndex];
    } else {
      // Reset to original input
      this.currentIndex = -1;
      return this.originalInput;
    }
  }

  public reset(): void {
    this.currentIndex = -1;
    this.originalInput = "";
  }

  public async refresh(): Promise<void> {
    await this.loadHistory();
    this.reset();
  }
}