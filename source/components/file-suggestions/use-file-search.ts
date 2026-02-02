import { useState, useEffect, useRef } from "react";
import { useInput } from "ink";
import { glob } from "tinyglobby";
import fs from "fs/promises";
import path from "path";

const CACHE_TTL = 5000;
const GITIGNORE_CACHE_TTL = 300000;

type FileListEntry = {
  files: string[];
  timestamp: number;
};

type GitignoreCacheEntry = {
  patterns: string[];
  timestamp: number;
};

const fileCache = new Map<string, FileListEntry>();
const pendingRequests = new Map<string, Promise<string[]>>();
const gitignoreCache = new Map<string, GitignoreCacheEntry>();

async function getGitignorePatterns(cwd: string): Promise<string[]> {
  const cacheKey = cwd;
  const cached = gitignoreCache.get(cacheKey);
  const now = Date.now();

  if (cached && now - cached.timestamp < GITIGNORE_CACHE_TTL) {
    return cached.patterns;
  }

  const gitignorePath = path.join(cwd, ".gitignore");
  let content: string;

  try {
    content = await fs.readFile(gitignorePath, "utf-8");
  } catch {
    return [];
  }

  const patterns = content
    .split("\n")
    .filter(line => line && !line.trim().startsWith("#"))
    .map(line => line.trim())
    .filter(line => line && line !== ".git/");

  gitignoreCache.set(cacheKey, { patterns, timestamp: now });
  return patterns;
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

  const gitignorePatterns = await getGitignorePatterns(cwd);

  const promise = glob(["**/*"], {
    cwd,
    ignore: [...gitignorePatterns, "node_modules/**", ".git/**", "dist/**"],
    absolute: false,
  });

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
