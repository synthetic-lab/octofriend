import { octoAgent } from "./ir/octo-ir.ts";
import type { ToolCall } from "./libocto/tool-def.ts";
import type { PermissionDecision, PermissionGate } from "./libocto/permissions.ts";
import type toolMap from "./tools/tool-defs/index.ts";

export type ToolCallRequest = ToolCall<typeof toolMap>;

export type RejectionTransaction = {
  commitRejection: (steering: string) => void;
};

export type OctoGateState = {
  rejectionTx: RejectionTransaction | null;
  whitelistState: Set<string>;
};

export type OctoPermissionLifecycle = {
  onWhitelist: (whitelistState: Set<string>) => void;
  onBeginRejection: (rejectionTx: RejectionTransaction) => void;
  onCommitRejection: () => void;
};

export type OctoPermissionController = (control: OctoPermissionControl) => void | Promise<void>;

export function whitelistKey(toolCall: ToolCallRequest): string {
  switch (toolCall.name) {
    case "read":
    case "partial-read":
    case "list":
      return "read:*";
    case "create":
    case "rewrite":
    case "edit":
      return "edits:*";
    case "mcp":
      return `mcp:${toolCall.parsed.server}:${toolCall.parsed.tool}`;
    default:
      return `${toolCall.name}:*`;
  }
}

export class OctoPermissionControl {
  readonly toolCall: ToolCallRequest;
  readonly decision: Promise<PermissionDecision>;
  private rejectionTx: RejectionTransaction | null;
  private whitelistState: Set<string>;
  private readonly lifecycle: OctoPermissionLifecycle;
  private resolveDecision!: (decision: PermissionDecision) => void;

  constructor(args: {
    toolCall: ToolCallRequest;
    state: OctoGateState;
    lifecycle: OctoPermissionLifecycle;
  }) {
    this.toolCall = args.toolCall;
    this.rejectionTx = args.state.rejectionTx;
    this.whitelistState = args.state.whitelistState;
    this.lifecycle = args.lifecycle;
    this.decision = new Promise<PermissionDecision>(resolve => {
      this.resolveDecision = resolve;
    });
  }

  allow(): void {
    this.resolveDecision({ decision: "allow" });
  }

  allowAndWhitelist(): void {
    const whitelistState = new Set(this.whitelistState);
    whitelistState.add(whitelistKey(this.toolCall));
    this.whitelistState = whitelistState;
    this.lifecycle.onWhitelist(whitelistState);
    this.resolveDecision({ decision: "allow" });
  }

  beginReject(): RejectionTransaction {
    const rejectionTx: RejectionTransaction = {
      commitRejection: (steering: string) => {
        this.rejectionTx = null;
        this.lifecycle.onCommitRejection();
        this.resolveDecision({ decision: "reject", steering });
      },
    };
    this.rejectionTx = rejectionTx;
    this.lifecycle.onBeginRejection(rejectionTx);
    return rejectionTx;
  }
}

export function octoPermissionGate(
  args: {
    state: OctoGateState;
    controller: OctoPermissionController;
  } & OctoPermissionLifecycle,
): PermissionGate<typeof octoAgent> {
  return async toolCall => {
    const control = new OctoPermissionControl({
      toolCall,
      state: args.state,
      lifecycle: args,
    });
    await args.controller(control);
    return await control.decision;
  };
}
