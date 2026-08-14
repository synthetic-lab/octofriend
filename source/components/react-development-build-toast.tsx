import React, { useEffect } from "react";
import { useToast } from "./toast.tsx";

function isReactDevelopmentBuild(): boolean {
  // Which react build runs is decided by NODE_ENV (react's cjs entry branches
  // on it, and compiled binaries fold the branch at build time via the
  // NODE_ENV burned in from the build environment).
  return process.env.NODE_ENV !== "production";
}

export function ReactDevelopmentBuildToast() {
  const showToast = useToast();

  useEffect(() => {
    if (isReactDevelopmentBuild()) showToast("⚠️ React development build");
  }, [showToast]);

  return null;
}
