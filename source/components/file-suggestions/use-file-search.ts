import { useState, useEffect, useRef } from "react";
import { useInput } from "ink";
import { glob } from "tinyglobby";
import fs from "fs/promises";
import path from "path";
import ignore from "ignore";

const CACHE_TTL = 5000;
const GITIGNORE_CACHE_TTL = 300000;

const FOLDERS = new Set([
  "node_modules",
  "bower_components",
  ".pnpm-store",
  "vendor",
  ".npm",
  "dist",
  "build",
  "out",
  ".next",
  "target",
  "bin",
  "obj",
  ".git",
  ".svn",
  ".hg",
  ".vscode",
  ".idea",
  ".turbo",
  ".output",
  "desktop",
  ".sst",
  ".cache",
  ".webkit-cache",
  "__pycache__",
  ".pytest_cache",
  "mypy_cache",
  ".history",
  ".gradle",
]);

const FOLDER_PATTERNS = [...FOLDERS].map(f => `${f}/**`);

type FileListEntry = {
  files: string[];
  timestamp: number;
};

type GitignoreCacheEntry = {
  content: string;
  timestamp: number;
};

const fileCache = new Map<string, FileListEntry>();
const pendingRequests = new Map<string, Promise<string[]>>();
const gitignoreCache = new Map<string, GitignoreCacheEntry>();

async function getGitignoreFilter(cwd: string): Promise<ignore.Ignore> {
  const cacheKey = cwd;
  const cached = gitignoreCache.get(cacheKey);
  const now = Date.now();

  if (cached && now - cached.timestamp < GITIGNORE_CACHE_TTL) {
    return ignore().add(cached.content);
  }

  const gitignorePath = path.join(cwd, ".gitignore");
  let content: string;

  try {
    content = await fs.readFile(gitignorePath, "utf-8");
  } catch {
    return ignore();
  }

  gitignoreCache.set(cacheKey, { content, timestamp: now });
  return ignore().add(content);
}

async function getCachedFileList(): Promise<string[]> {
  const cwd = process.cwd();
  const now = Date.now();
  const cached = fileCache.get(cwd);

  if (cached && now - cached.timestamp < CACHE_TTL) {
    return cached.files;
  }

  const pending = pendingRequests.get(cwd);
  if (pending) {
    return pending;
  }

  const ig = await getGitignoreFilter(cwd);

  // Two-stage filtering strategy:
  // 1. Pre-filter: Use FOLDER_PATTERNS to exclude common directories (node_modules, .git, etc.)
  //    at the glob search level for performance. This prevents searching inside these dirs.
  // 2. Post-filter: Use the ignore library to filter results based on .gitignore rules.
  //    This provides full gitignore spec compliance (negation, anchored patterns, etc.)
  const promise = glob(["**/*"], {
    cwd,
    ignore: FOLDER_PATTERNS,
    absolute: false,
  }).then(files => ig.filter(files));

  pendingRequests.set(cwd, promise);

  try {
    const files = await promise;
    fileCache.set(cwd, { files, timestamp: now });
    return files;
  } finally {
    pendingRequests.delete(cwd);
  }
}

async function searchFiles(query: string): Promise<string[]> {
  const files = await getCachedFileList();

  if (!query) return files.slice(0, 20);

  const queryLower = query.toLowerCase();

  const matches = files.filter(f => f.toLowerCase().includes(queryLower));
  if (matches.length > 0) {
    return matches.slice(0, 20);
  }

  return files
    .filter(f => {
      const filename = f.split("/").pop()?.toLowerCase() ?? "";
      return filename.startsWith(queryLower);
    })
    .slice(0, 20);
}

interface UseFileSearchOptions {
  onSelect: (filename: string) => void;
  debounceMs?: number;
}

export function useFileSearch(query: string, options: UseFileSearchOptions) {
  const [results, setResults] = useState<string[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [isLoading, setIsLoading] = useState(false);

  const timerRef = useRef<NodeJS.Timeout | undefined>(undefined);
  const currentRequestId = useRef(0);
  const isMounted = useRef(true);

  useEffect(() => {
    clearTimeout(timerRef.current);

    const thisRequest = ++currentRequestId.current;
    const debounceMs = options.debounceMs ?? 100;

    timerRef.current = setTimeout(async () => {
      try {
        if (isMounted.current) {
          setIsLoading(true);
        }

        const matches = await searchFiles(query);

        if (thisRequest === currentRequestId.current && isMounted.current) {
          setResults(matches);
          setSelectedIndex(0);
        }
      } catch (err) {
        if (thisRequest === currentRequestId.current && err instanceof Error) {
          console.error("Search failed:", err);
        }
      } finally {
        if (thisRequest === currentRequestId.current && isMounted.current) {
          setIsLoading(false);
        }
      }
    }, debounceMs);

    return () => {
      clearTimeout(timerRef.current);
    };
  }, [query, options.debounceMs]);

  useEffect(() => {
    return () => {
      isMounted.current = false;
      clearTimeout(timerRef.current);
    };
  }, []);

  useInput(
    (input: string, key: { upArrow?: boolean; downArrow?: boolean; return?: boolean }) => {
      if (key.upArrow) {
        setSelectedIndex(prev => Math.max(0, prev - 1));
      } else if (key.downArrow) {
        setSelectedIndex(prev => Math.min(results.length - 1, prev + 1));
      } else if (key.return) {
        const selected = results[selectedIndex];
        if (selected) {
          options.onSelect(selected);
        }
      }
    },
    { isActive: true },
  );

  return { results, selectedIndex, isLoading };
}
