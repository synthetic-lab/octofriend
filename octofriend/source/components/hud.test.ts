import { describe, expect, it } from "bun:test";
import { hudSectionColors, hudTextOffset, responsiveHudSections } from "./hud.tsx";
import {
  HUD_BRANCH_BACKGROUND_COLOR,
  HUD_CONTEXT_BACKGROUND_COLOR,
  HUD_CONTEXT_DANGER_BACKGROUND_COLOR,
  HUD_CONTEXT_WARNING_BACKGROUND_COLOR,
  HUD_CWD_BACKGROUND_COLOR,
  HUD_DARK_TEXT_COLOR,
  HUD_LIGHT_TEXT_COLOR,
  HUD_MODEL_BACKGROUND_COLOR,
} from "../theme.ts";

function section(text: string) {
  return { text };
}

describe("responsiveHudSections", () => {
  const cwd = section("~/project");
  const branch = section("main");
  const model = section("model");
  const context = section("50% ctx");

  it("keeps every section when the full HUD fits", () => {
    const allSections = [cwd, branch, model, context];
    expect(responsiveHudSections(allSections, true, 65, false, false)).toEqual(allSections);
  });

  it("drops the branch first when the full HUD does not fit", () => {
    expect(responsiveHudSections([cwd, branch, model, context], true, 60, false, false)).toEqual([
      cwd,
      model,
      context,
    ]);
  });

  it("keeps only the model when the branchless HUD does not fit", () => {
    expect(responsiveHudSections([cwd, branch, model, context], true, 55, false, false)).toEqual([
      model,
    ]);
  });

  it("keeps the model visible on extremely narrow screens without a branch", () => {
    expect(responsiveHudSections([cwd, model, context], false, 0, false, false)).toEqual([model]);
  });
});

describe("hudTextOffset", () => {
  it("matches the first HUD character with and without a corner or collapsed pill", () => {
    expect(hudTextOffset({ legacyCorner: false }, false)).toBe(1);
    expect(hudTextOffset({ legacyCorner: true }, false)).toBe(2);
    expect(hudTextOffset({ legacyCorner: false }, true)).toBe(2);
  });
});

describe("hudSectionColors", () => {
  it("uses the visible index for both foreground and background colors", () => {
    const model = section("model");
    expect(hudSectionColors(model, 0)).toEqual({
      color: HUD_LIGHT_TEXT_COLOR,
      backgroundColor: HUD_CWD_BACKGROUND_COLOR,
    });
    expect(hudSectionColors(model, 1)).toEqual({
      color: HUD_LIGHT_TEXT_COLOR,
      backgroundColor: HUD_BRANCH_BACKGROUND_COLOR,
    });
    expect(hudSectionColors(model, 2)).toEqual({
      color: HUD_LIGHT_TEXT_COLOR,
      backgroundColor: HUD_MODEL_BACKGROUND_COLOR,
    });
    expect(hudSectionColors(model, 3)).toEqual({
      color: HUD_DARK_TEXT_COLOR,
      backgroundColor: HUD_CONTEXT_BACKGROUND_COLOR,
    });
  });

  it("allows context warning and danger colors to override the indexed colors", () => {
    expect(
      hudSectionColors(
        {
          text: "70% ctx",
          overrideBackgroundColor: HUD_CONTEXT_WARNING_BACKGROUND_COLOR,
          overrideForegroundColor: HUD_DARK_TEXT_COLOR,
        },
        2,
      ),
    ).toEqual({
      color: HUD_DARK_TEXT_COLOR,
      backgroundColor: HUD_CONTEXT_WARNING_BACKGROUND_COLOR,
    });
    expect(
      hudSectionColors(
        {
          text: "80% ctx",
          overrideBackgroundColor: HUD_CONTEXT_DANGER_BACKGROUND_COLOR,
          overrideForegroundColor: HUD_DARK_TEXT_COLOR,
        },
        0,
      ),
    ).toEqual({
      color: HUD_DARK_TEXT_COLOR,
      backgroundColor: HUD_CONTEXT_DANGER_BACKGROUND_COLOR,
    });
  });
});
