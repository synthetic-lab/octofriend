import { useState, useEffect, useRef } from "react";
import ignore from "ignore";
import { usePriorityInput, FILE_SUGGESTIONS_PRIORITY } from "../../hooks/use-priority-input.tsx";
import { useTransport } from "../../transport-context.ts";
import { globFiles } from "../../transports/transport-common.ts";

const MAX_SUGGESTIONS = 8;
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

async function getGitignoreFilter(
  cwd: string,
  readFile: (path: string) => Promise<string>,
): Promise<ignore.Ignore> {
  const cacheKey = cwd;
  const cached = gitignoreCache.get(cacheKey);
  const now = Date.now();

  if (cached && now - cached.timestamp < GITIGNORE_CACHE_TTL) {
    return ignore().add(cached.content);
  }

  const gitignorePath = `${cwd}/.gitignore`;
  let content: string;

  try {
    content = await readFile(gitignorePath);
  } catch {
    return ignore();
  }

  gitignoreCache.set(cacheKey, { content, timestamp: now });
  return ignore().add(content);
}

async function getCachedFileList(
  transport: ReturnType<typeof useTransport>,
  signal: AbortSignal,
): Promise<string[]> {
  const cwd = await transport.cwd(signal);
  const now = Date.now();
  const cached = fileCache.get(cwd);

  if (cached && now - cached.timestamp < CACHE_TTL) {
    return cached.files;
  }

  const pending = pendingRequests.get(cwd);
  if (pending) {
    return pending;
  }

  const readFile = async (filePath: string) => transport.readFile(signal, filePath);
  const ig = await getGitignoreFilter(cwd, readFile);

  const promise = globFiles(signal, transport, ["**/*"], {
    ignore: FOLDER_PATTERNS,
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

async function searchFiles(
  query: string,
  transport: ReturnType<typeof useTransport>,
  signal: AbortSignal,
): Promise<string[]> {
  const files = await getCachedFileList(transport, signal);

  // Sort by path length (shortest first) for better UX
  files.sort((a, b) => a.length - b.length);

  if (!query) return files.slice(0, MAX_SUGGESTIONS);

  const queryLower = query.toLowerCase();

  const matches = files.filter(f => f.toLowerCase().includes(queryLower));
  if (matches.length > 0) {
    return matches.slice(0, MAX_SUGGESTIONS);
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
  const transport = useTransport();

  const timerRef = useRef<NodeJS.Timeout | undefined>(undefined);
  const currentRequestId = useRef(0);
  const isMounted = useRef(true);
  const abortControllerRef = useRef<AbortController | null>(null);

  useEffect(() => {
    clearTimeout(timerRef.current);

    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    abortControllerRef.current = new AbortController();

    const thisRequest = ++currentRequestId.current;
    const debounceMs = options.debounceMs ?? 100;

    timerRef.current = setTimeout(async () => {
      try {
        if (isMounted.current) {
          setIsLoading(true);
        }

        const signal = abortControllerRef.current!.signal;
        const matches = await searchFiles(query, transport, signal);

        if (thisRequest === currentRequestId.current && isMounted.current) {
          setResults(matches);
          setSelectedIndex(0);
        }
      } catch (err) {
        if (
          thisRequest === currentRequestId.current &&
          err instanceof Error &&
          err.name !== "AbortError"
        ) {
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
  }, [query, options.debounceMs, transport]);

  useEffect(() => {
    return () => {
      isMounted.current = false;
      clearTimeout(timerRef.current);
      abortControllerRef.current?.abort();
    };
  }, []);

  const selectPrev = () => {
    setSelectedIndex(prev => Math.max(0, prev - 1));
  };

  usePriorityInput(FILE_SUGGESTIONS_PRIORITY, (_, key) => {
    if (key.upArrow || (key.shift && key.tab)) {
      selectPrev();
    } else if (key.downArrow || key.tab) {
      setSelectedIndex(prev => Math.min(results.length - 1, prev + 1));
    } else if (key.return) {
      const selected = results[selectedIndex];
      if (selected) {
        options.onSelect(selected);
      }
    }
  });

  return { results, selectedIndex, isLoading };
}
