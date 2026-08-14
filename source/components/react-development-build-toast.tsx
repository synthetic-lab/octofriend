import { useEffect } from "react";
import { createRequire } from "node:module";
import { basename } from "node:path";
import { useToast } from "./toast.tsx";

const nodeRequire = createRequire(import.meta.url);

function isReactDevelopmentBuild(): boolean {
  const reactModule = nodeRequire.cache[nodeRequire.resolve("react")];
  return (
    reactModule?.children.some(child => basename(child.filename) === "react.development.js") ??
    false
  );
}

export function ReactDevelopmentBuildToast() {
  const showToast = useToast();

  useEffect(() => {
    if (isReactDevelopmentBuild()) showToast("⚠️ React development build");
  }, [showToast]);

  return null;
}
