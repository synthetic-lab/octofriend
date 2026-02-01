import { useState, useEffect, useRef } from "react";
import { useInput } from "ink";
import { glob } from "tinyglobby";

async function searchFiles(query: string): Promise<string[]> {
  const cwd = process.cwd();

  const files = await glob(["**/*"], {
    cwd,
    ignore: ["node_modules/**", ".git/**", "dist/**"],
    absolute: false,
  });

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
