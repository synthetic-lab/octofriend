import { useState, useEffect } from "react";
import { ToolCallRequest } from "../../ir/llm-ir.ts";
import { ContextProvider, FormatLabelContext } from "./category-whitelist-types.ts";
import { extractToolPermissionInfo, ToolPermissionInfo } from "./tool-permission-info.ts";
import { categoryConfigs } from "./merged-whitelist.ts";
import { TOOL_CATEGORIES } from "../tool-defs/categories.ts";
import { WhitelistCategory } from "./merged-whitelist.ts";

const DEFAULT_CONTEXT: FormatLabelContext = { permissionContext: "" };

function getToolCategory(toolName: string): WhitelistCategory | null {
  for (const [category, tools] of Object.entries(TOOL_CATEGORIES)) {
    if ((tools as readonly string[]).includes(toolName)) {
      return category as WhitelistCategory;
    }
  }
  return null;
}

export function useToolPermissionInfo(
  toolReq: ToolCallRequest,
  contextProvider: ContextProvider,
): ToolPermissionInfo | null {
  const [context, setContext] = useState<FormatLabelContext | null>(null);

  useEffect(() => {
    const abortController = new AbortController();
    const category = getToolCategory(toolReq.function.name);

    if (category) {
      const config = categoryConfigs[category];
      if (config.getContext) {
        config
          .getContext(contextProvider, abortController.signal)
          .then(setContext)
          .catch(() => {});
      } else {
        setContext(DEFAULT_CONTEXT);
      }
    } else {
      setContext(DEFAULT_CONTEXT);
    }

    return () => abortController.abort();
  }, [toolReq.function.name, contextProvider]);

  if (context === null) return null;

  return extractToolPermissionInfo(toolReq, context);
}
