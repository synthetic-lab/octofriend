import { t } from "structural";
import { BASE_IR_TOOL, withIR, defineAgent, LlmIR, AgentTrajectory } from "./generic-llm-ir.ts";

const FILE_IR_TOOL = withIR<{
  role: "file-read";
  contents: string;
}>();
const read = FILE_IR_TOOL.declare({
  name: "read",
  ArgumentsSchema: t.subtype({
    path: t.str,
  }),
  ParsedSchema: t.subtype({
    path: t.str,
    originalFileContents: t.str,
  }),
  subagents: ["view"],
}).define(async () => {
  return {
    parse: async ({ original }) => {
      return {
        success: true,
        data: {
          original,
          parsed: {
            ...original,
            originalFileContents: "hello",
          },
        },
      };
    },
    validate: async () => ({ success: true, data: null }),
    run: async () => {
      return {
        success: true,
        data: {
          type: "custom-ir",
          data: {
            role: "file-read",
            contents: "idk",
          },
        },
      };
    },
  };
});
const list = BASE_IR_TOOL.declare({
  name: "list",
  ArgumentsSchema: t.subtype({
    path: t.str,
  }),
}).define(async () => {
  return {
    run: async () => {
      return {
        success: false,
        error: "idk",
      };
    },
  };
});

const glob = BASE_IR_TOOL.declare({
  name: "glob",
  ArgumentsSchema: t.subtype({}),
}).define(async () => ({
  run: async () => {
    return {
      success: false,
      error: "idk",
    };
  },
}));

const write = BASE_IR_TOOL.declare({
  name: "write",
  ArgumentsSchema: t.subtype({}),
}).define(async () => {
  return {
    run: async () => {
      return {
        success: false,
        error: "idk",
      };
    },
  };
});

const dynamicRead = FILE_IR_TOOL.dynamicDefineTool(async () => {
  return FILE_IR_TOOL.declare({
    name: "dynamic-read",
    ArgumentsSchema: t.subtype({
      path: t.str,
    }),
    ParsedSchema: t.subtype({
      path: t.str,
      originalFileContents: t.str,
    }),
    subagents: ["view"],
  }).define(async () => {
    return {
      parse: async ({ original }) => {
        return {
          success: true,
          data: {
            original,
            parsed: {
              ...original,
              originalFileContents: "hello",
            },
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
type DynamicTestAgent = LlmIR<typeof dynamicSuccessAgent>;

const a: TestAgentIR = new AgentTrajectory("explore", []) as TestAgentIR;
const dynamicA: DynamicTestAgent = {} as DynamicTestAgent;

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

const _unparseableRead = FILE_IR_TOOL.declare({
  name: "unparseable-read",
  ArgumentsSchema: t.subtype({
    path: t.str,
  }),
  ParsedSchema: t.subtype({
    path: t.str,
    originalFileContents: t.str,
  }),
}).define(
  // We expect an error here because parse returns the wrong format
  // @ts-expect-error
  async () => {
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
  },
);
