import { t } from "structural";
import { AgentTrajectory, defineAgent, LlmIR } from "./llm-ir.ts";
import { tools, ToolBuilder, ToolCall } from "./tool-def.ts";
import { result } from "../result.ts";

const BUILDER = new ToolBuilder();

function testFileIR<T extends ToolCall<any>>(toolCall: T) {
  return (args: { contents: string }) => ({
    role: "file-read" as const,
    contents: args.contents,
    toolCall,
  });
}

const readDeclaration = BUILDER.declare({
  name: "read",
  description: "Reads a file",
  ArgumentsSchema: t.subtype({
    path: t.str,
  }),
  ParsedSchema: t.subtype({
    path: t.str,
    originalFileContents: t.str,
  }),
  subagents: ["view"],
});
const read = readDeclaration.withCustomIR({ testFileIR }).define(async () => {
  return {
    parse: async ({ original }) => {
      return result.ok({
        original,
        parsed: {
          ...original,
          originalFileContents: "hello",
        },
      });
    },
    validate: async () => result.ok(null),
    run: async ({ customIR }) => {
      return customIR.testFileIR({ contents: "idk" });
    },
  };
});
const list = tools
  .declare({
    name: "list",
    description: "Lists files",
    ArgumentsSchema: t.subtype({
      path: t.str,
    }),
  })
  .define(async () => {
    return {
      run: async () => result.err("idk"),
    };
  });

const glob = tools
  .declare({
    name: "glob",
    description: "Globs files",
    ArgumentsSchema: t.subtype({}),
  })
  .define(async () => ({
    run: async () => result.err("idk"),
  }));

const write = tools
  .declare({
    name: "write",
    description: "Writes a file",
    ArgumentsSchema: t.subtype({}),
  })
  .define(async () => {
    return {
      run: async () => result.err("idk"),
    };
  });

const DATA_TOOL = BUILDER.withData<{
  prefix: string;
}>()
  .declare({
    name: "data-tool",
    description: "Uses builder data",
    ArgumentsSchema: t.subtype({}),
  })
  .define(async ({ data }) => {
    const prefix: string = data.prefix;
    // We expect an error here because withData controls the factory data shape
    // @ts-expect-error
    data.missing;

    return {
      run: async ({ data }) => {
        const runPrefix: string = data.prefix;
        return result.ok({
          type: "output",
          content: [{ type: "text", content: `${prefix}:${runPrefix}` }],
        });
      },
    };
  });

const fileDataDeclaration = BUILDER.withData<{
  prefix: string;
}>().declare({
  name: "file-data-tool",
  description: "Uses builder data and emits file IR",
  ArgumentsSchema: t.subtype({}),
});
const FILE_DATA_TOOL = fileDataDeclaration.withCustomIR({ testFileIR }).define(async ({ data }) => {
  const prefix: string = data.prefix;

  return {
    run: async ({ customIR }) => {
      return customIR.testFileIR({ contents: prefix });
    },
  };
});

const dynamicReadDeclaration = BUILDER.declare({
  name: "dynamic-read",
  description: "Reads a file dynamically",
  ArgumentsSchema: t.subtype({
    path: t.str,
  }),
  ParsedSchema: t.subtype({
    path: t.str,
    originalFileContents: t.str,
  }),
  subagents: ["view"],
});
const dynamicRead = BUILDER.dynamicDefineTool(async () => {
  return dynamicReadDeclaration.withCustomIR({ testFileIR }).define(async () => {
    return {
      parse: async ({ original }) => {
        return result.ok({
          original,
          parsed: {
            ...original,
            originalFileContents: "hello",
          },
        });
      },
      validate: async () => result.ok(null),
      run: async () => {
        return result.err("idk");
      },
    };
  });
});

const allTools = {
  read,
  list,
  glob,
  write,
  dynamicRead,
};
const dynamicTools = {
  dynamicRead,
};
const exploreTools = {
  read,
  list,
  glob,
};
const reviewTools = {
  read,
  list,
};

const viewAgent = defineAgent({
  tools: {},
  agents: {},
});
const dynamicSuccessAgent = defineAgent({
  tools: dynamicTools,
  agents: {
    view: viewAgent,
  },
});
const successAgent = defineAgent({
  tools: allTools,

  agents: {
    explore: {
      tools: exploreTools,
      agents: {
        nested: {
          tools: [],
          agents: {},
        },
        view: viewAgent,
      },
    },
    review: {
      tools: reviewTools,
      agents: {
        view: viewAgent,
      },
    },

    view: viewAgent,
  },
});

type TestAgentIR = LlmIR<typeof successAgent>;
type DynamicTestAgentIR = LlmIR<typeof dynamicSuccessAgent>;

const a: TestAgentIR = new AgentTrajectory("explore", []) as TestAgentIR;
const dynamicA: DynamicTestAgentIR = {} as DynamicTestAgentIR;

if (dynamicA.role === "tool-output") {
  if (dynamicA.toolCall.name === "dynamic-read") {
    console.log(dynamicA.toolCall.parsed.originalFileContents);
  }
}

if (a.role === "tool-output") {
  if (a.toolCall.name === "dynamic-read") {
    console.log(a.toolCall.parsed.originalFileContents);
  }
}

if (a.role === "file-read") {
  console.log(a.contents);
}

if (a.role === "trajectory") {
  const syncCondResult = a.cond({
    explore: () => "explore",
    review: () => "review",
    view: () => "view",
  });
  const _syncCondString: string = syncCondResult;
  // We expect an error here because all handlers are sync, so cond does not return a Promise
  // @ts-expect-error
  const _syncCondPromise: Promise<string> = syncCondResult;

  const asyncCondResult = a.cond({
    explore: async () => "explore",
    review: async () => "review",
    view: async () => "view",
  });
  const _asyncCondPromise: Promise<string> = asyncCondResult;
  // We expect an error here because all handlers are async, so cond returns a Promise
  // @ts-expect-error
  const _asyncCondString: string = asyncCondResult;

  // We expect an error here because cond handlers cannot mix sync and async returns
  // @ts-expect-error
  a.cond({
    explore: async () => "explore",
    review: () => "review",
    view: () => "view",
  });

  await a.cond({
    explore: async trajectory => {
      const first = trajectory.ir[0];
      if (first.role === "tool-output") {
        if (first.toolCall.name === "glob") {
          console.log("glorb");
        }

        if (first.toolCall.name === "read") {
          console.log(first.toolCall.parsed.originalFileContents);
        }
        if (first.toolCall.name === "list") {
          console.log(first.toolCall.parsed.path);
        }
      }
      if (first.role === "trajectory") {
        await first.cond({
          nested: _ => {},
          view: _ => {},
        });
      }
    },
    review: async _ => {},
    view: async trajectory => {
      const first = trajectory.ir[0];
      first.role;
    },
  });
}

// We expect an error here because the main agent doesn't define a view subagent
// @ts-expect-error
const missingSubagent = defineAgent({
  tools: allTools,

  agents: {
    explore: {
      tools: exploreTools,
      agents: {
        nested: {
          tools: [],
          agents: {},
        },
        view: viewAgent,
      },
    },
    review: {
      tools: reviewTools,
      agents: {
        view: viewAgent,
      },
    },
  },
});

const _missingNestedSubagent = defineAgent({
  tools: allTools,

  agents: {
    // We expect an error here because explore does not define the view subagent
    // @ts-expect-error
    explore: {
      tools: exploreTools,
      agents: {
        nested: {
          tools: [],
          agents: {},
        },
      },
    },
    review: {
      tools: reviewTools,
      agents: {
        view: viewAgent,
      },
    },
    view: viewAgent,
  },
});

// We expect an error here because the dynamic tool requires a view subagent
// @ts-expect-error
const _missingDynamicSubagent = defineAgent({
  tools: dynamicTools,
  agents: {},
});

const unparseableReadDeclaration = BUILDER.declare({
  name: "unparseable-read",
  description: "Cannot parse correctly",
  ArgumentsSchema: t.subtype({
    path: t.str,
  }),
  ParsedSchema: t.subtype({
    path: t.str,
    originalFileContents: t.str,
  }),
});
const _unparseableRead = unparseableReadDeclaration
  .withCustomIR({ testFileIR })
  // We expect an error here because parse returns the wrong format
  // @ts-expect-error
  .define(async () => {
    return {
      parse: async ({ original }) => {
        return {
          success: true,
          data: {
            original,
            parsed: original,
          },
        };
      },
      validate: async () => ({ success: true, data: null }),
      run: async () => {
        return {
          success: false,
          error: "idk",
        };
      },
    };
  });
