import { describe, expect, it, spyOn } from "bun:test";
import { withMock } from "antipattern";
import { BackgroundProcessManager, backgroundProcesses } from "../../background-process.ts";
import { MockTransport } from "../../transports/mock.ts";
import { unwrap } from "../../libocto/result.ts";
import backgroundProcessTool from "./background-process.ts";
import manageBackgroundProcessTool from "./manage-background-process.ts";

async function createTools(controller: AbortController) {
  const transport = new MockTransport({});
  const context = { signal: controller.signal, transport, data: {} as never };
  const start = await backgroundProcessTool(context);
  const manage = await manageBackgroundProcessTool(context);
  if (!start || !manage) throw new Error("Background process tools did not load");
  return {
    transport,
    start: () => {
      const call = {
        name: "background-process" as const,
        arguments: { cmd: "sleep 30", label: "server" },
      };
      return start.run({
        ...context,
        toolCall: { toolCallId: "start", original: call, parsed: call },
      });
    },
    manage: (action: "poll" | "kill" | "list", timeout: number | undefined) => {
      const call = {
        name: "manage-background-process" as const,
        arguments: { action, id: "bg-process-1", timeout },
      };
      return manage.run({
        ...context,
        toolCall: { toolCallId: "manage", original: call, parsed: call },
      });
    },
  };
}

describe("background process tool cancellation", () => {
  it("returns an error without spawning when cancelled before launch", async () => {
    const manager = new BackgroundProcessManager();
    await withMock(
      backgroundProcesses,
      "manager",
      () => manager,
      async () => {
        const controller = new AbortController();
        const tools = await createTools(controller);
        controller.abort();
        expect(await tools.start()).toMatchObject({ success: false, error: "Aborted by user" });
        expect(tools.transport.spawnCalls).toEqual([]);
        expect(manager.list()).toEqual([]);
      },
    );
  });

  it("returns synchronous spawn failures as tool errors", async () => {
    const manager = new BackgroundProcessManager();
    await withMock(
      backgroundProcesses,
      "manager",
      () => manager,
      async () => {
        const tools = await createTools(new AbortController());
        const spawn = spyOn(tools.transport, "spawn").mockImplementation(() => {
          throw new TypeError("Invalid spawn argument");
        });
        try {
          expect(await tools.start()).toMatchObject({
            success: false,
            error: "Failed to spawn background process: Invalid spawn argument",
          });
          expect(manager.list()).toEqual([]);
        } finally {
          spawn.mockRestore();
        }
      },
    );
  });

  it("cancels a poll in the launching batch without killing its background process", async () => {
    const manager = new BackgroundProcessManager();
    await withMock(
      backgroundProcesses,
      "manager",
      () => manager,
      async () => {
        const controller = new AbortController();
        const tools = await createTools(controller);
        unwrap(await tools.start());
        const poll = tools.manage("poll", 60_000);
        controller.abort();
        expect(unwrap(await poll)).toMatchObject({
          content: [{ type: "text", content: expect.stringContaining("running") }],
        });
        expect(manager.poll("bg-process-1")?.status).toEqual({
          state: "running",
        });
        tools.transport.spawnCalls[0].process.finish(0, null);
      },
    );
  });

  it("does not kill or drain output for management calls cancelled before they start", async () => {
    const manager = new BackgroundProcessManager();
    await withMock(
      backgroundProcesses,
      "manager",
      () => manager,
      async () => {
        const controller = new AbortController();
        const tools = await createTools(controller);
        unwrap(await tools.start());
        tools.transport.spawnCalls[0].process.stdout.write("still here");
        controller.abort();
        for (const action of ["poll", "kill", "list"] as const) {
          expect(await tools.manage(action, undefined)).toMatchObject({
            success: false,
            error: "Aborted by user",
          });
        }
        const background = manager.poll("bg-process-1")!;
        expect(background.status).toEqual({ state: "running" });
        expect(background.drainUnreadOutput().stdout).toBe("still here");
        tools.transport.spawnCalls[0].process.finish(0, null);
      },
    );
  });

  it("finishes an in-progress kill after cancellation and reports the final status", async () => {
    const manager = new BackgroundProcessManager();
    await withMock(
      backgroundProcesses,
      "manager",
      () => manager,
      async () => {
        const controller = new AbortController();
        const tools = await createTools(controller);
        unwrap(await tools.start());
        const process = tools.transport.spawnCalls[0].process;
        const terminate = spyOn(process, "terminate").mockImplementation(
          () => process.processClosedPromise,
        );
        try {
          const killing = tools.manage("kill", undefined);
          let settled = false;
          void killing.then(() => {
            settled = true;
          });
          controller.abort();
          await Promise.resolve();
          expect(settled).toBe(false);
          expect(terminate).toHaveBeenCalledWith({ graceMs: 1000 });
          process.stdout.write("shutting down");
          process.finish(null, "SIGKILL");
          const result = unwrap(await killing);
          expect(result).toMatchObject({
            content: [
              {
                type: "text",
                content: expect.stringMatching(/killed by signal SIGKILL[\s\S]*shutting down/),
              },
            ],
          });
          expect(manager.poll("bg-process-1")?.hasUndrainedOutput).toBe(false);
        } finally {
          terminate.mockRestore();
        }
      },
    );
  });
});
