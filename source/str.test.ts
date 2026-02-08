import { describe, it, expect, vi } from "vitest";

vi.mock("os", () => ({
  default: {
    homedir: vi.fn(),
  },
  homedir: vi.fn(),
}));

import os from "os";
import { displayPath } from "./str.ts";

describe("displayPath", () => {
  const homedirMock = vi.mocked(os.homedir);

  it("returns ./relative for a path under cwd", () => {
    vi.spyOn(process, "cwd").mockReturnValue("/home/user/project");
    homedirMock.mockReturnValue("/home/user");

    expect(displayPath("/home/user/project/src/file.ts")).toBe("./src/file.ts");
  });

  it("returns ~/relative for a path under home but not cwd", () => {
    vi.spyOn(process, "cwd").mockReturnValue("/other/workspace");
    homedirMock.mockReturnValue("/home/user");

    expect(displayPath("/home/user/docs/notes.txt")).toBe("~/docs/notes.txt");
  });

  it("returns absolute path when outside both cwd and home", () => {
    vi.spyOn(process, "cwd").mockReturnValue("/home/user/project");
    homedirMock.mockReturnValue("/home/user");

    expect(displayPath("/etc/config/settings.json")).toBe("/etc/config/settings.json");
  });

  it("prefers cwd when path is under both cwd and home", () => {
    vi.spyOn(process, "cwd").mockReturnValue("/home/user/project");
    homedirMock.mockReturnValue("/home/user");

    const result = displayPath("/home/user/project/lib/util.ts");
    expect(result).toBe("./lib/util.ts");
    expect(result).not.toMatch(/^~\//);
  });
});
