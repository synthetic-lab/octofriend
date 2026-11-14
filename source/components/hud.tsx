import React, { useEffect, useState } from "react";
import { Span, useApp } from "paintcannon-react";
import type { TerminalResizeEvent } from "paintcannon";
import { TerminalFlex } from "./terminal-flex.tsx";
import { useAppStore, useModel } from "../state.ts";
import { modelDisplayName, type SyntheticModel } from "../synthetic-models.ts";
import {
  HUD_BRANCH_BACKGROUND_COLOR,
  HUD_CONTEXT_BACKGROUND_COLOR,
  HUD_CONTEXT_DANGER_BACKGROUND_COLOR,
  HUD_CONTEXT_WARNING_BACKGROUND_COLOR,
  HUD_CWD_BACKGROUND_COLOR,
  HUD_DARK_TEXT_COLOR,
  HUD_LIGHT_TEXT_COLOR,
  HUD_MODEL_BACKGROUND_COLOR,
  MODAL_BACKGROUND_COLOR,
} from "../theme.ts";
import { useCwd } from "../hooks/use-cwd.tsx";
import { useEnvironment } from "../environment.tsx";
import { useFontCapabilities } from "../font-capabilities.tsx";
import { TopLeftCorner } from "./corner.tsx";

const MAX_MODEL_CHARS = 24;
const MAX_CWD_CHARS = 36;
const MAX_BRANCH_CHARS = 28;

// Room for the always-visible Ctrl+p hint on the strip next to the HUD, plus slack for
// row chrome we don't measure directly.
const HINT_COLS = 32;

const DIVIDER = String.fromCodePoint(0xe0b4); // powerline right-pointing rounded cap
const BRANCH_ICON = String.fromCodePoint(0xe0a0); // powerline git branch glyph
const ROBOT_ICON = String.fromCodePoint(0xee0d); // nerd font robot glyph

const HUD_SECTION_COLORS = [
  { color: HUD_LIGHT_TEXT_COLOR, backgroundColor: HUD_CWD_BACKGROUND_COLOR },
  { color: HUD_LIGHT_TEXT_COLOR, backgroundColor: HUD_BRANCH_BACKGROUND_COLOR },
  { color: HUD_LIGHT_TEXT_COLOR, backgroundColor: HUD_MODEL_BACKGROUND_COLOR },
  { color: HUD_DARK_TEXT_COLOR, backgroundColor: HUD_CONTEXT_BACKGROUND_COLOR },
] as const;

type Section = {
  text: string;
  overrideBackgroundColor?: string;
  overrideForegroundColor?: string;
};

type HudLayout = {
  sections: Section[];
  legacyCorner: boolean;
  powerlineExtended: boolean;
};

export function useHudLayout(syntheticModels: SyntheticModel[]): HudLayout {
  const model = useModel();
  const cwd = useCwd();
  const { branch, home } = useEnvironment();
  const {
    powerline,
    "powerline-extended": powerlineExtended,
    "material-design": materialDesign,
    legacyComputing: legacyCorner,
  } = useFontCapabilities();
  const cols = useTerminalCols();
  const sessionMode = useAppStore(state => state.sessionMode);
  const history = useAppStore(state => state.history);

  const [percentUsed, setPercentUsed] = useState<number | null>(null);
  useEffect(() => {
    if (sessionMode.mode !== "live") return;
    let current = true;
    void sessionMode.trajectory.instance.primaryAgentApproximateContext().then(used => {
      if (current) setPercentUsed(Math.min(1, used / model.context));
    });
    return () => {
      current = false;
    };
  }, [sessionMode, history, model.context]);

  const allSections: Section[] = [];
  allSections.push({
    text: truncateCwd(displayCwd(cwd, home), MAX_CWD_CHARS),
  });
  if (branch != null) {
    const icon = powerline ? `${BRANCH_ICON} ` : "";
    allSections.push({
      text: truncateEnd(`${icon}${branch}`, MAX_BRANCH_CHARS),
    });
  }
  const modelIcon = materialDesign ? `${ROBOT_ICON}  ` : "";
  const modelSection = {
    text: truncateEnd(`${modelIcon}${modelDisplayName(model, syntheticModels)}`, MAX_MODEL_CHARS),
  };
  allSections.push(modelSection);
  if (percentUsed != null && Math.round(percentUsed * 100) > 0) {
    const overrideBackgroundColor = contextBackgroundColor(percentUsed);
    allSections.push({
      text: `${Math.round(percentUsed * 100)}% ctx`,
      overrideBackgroundColor: overrideBackgroundColor ?? undefined,
      overrideForegroundColor: overrideBackgroundColor == null ? undefined : HUD_DARK_TEXT_COLOR,
    });
  }

  const sections = responsiveHudSections(
    allSections,
    branch != null,
    cols,
    legacyCorner,
    powerlineExtended,
  );
  return { sections, legacyCorner, powerlineExtended };
}

export function useHudTextOffset(collapsed: boolean): number {
  const { legacyComputing } = useFontCapabilities();
  return hudTextOffset({ legacyCorner: legacyComputing }, collapsed);
}

export function hudTextOffset(layout: Pick<HudLayout, "legacyCorner">, collapsed: boolean): number {
  return 1 + (collapsed || layout.legacyCorner ? 1 : 0);
}

export function responsiveHudSections(
  allSections: Section[],
  hasBranch: boolean,
  cols: number,
  legacyCorner: boolean,
  powerlineExtended: boolean,
): Section[] {
  const fits = (sections: Section[]) =>
    stripWidth(sections, legacyCorner, powerlineExtended) <= cols - HINT_COLS;
  if (fits(allSections)) return allSections;

  // Drop the branch first, then everything except the model on small screens.
  const modelIndex = hasBranch ? 2 : 1;
  const withoutBranch = hasBranch ? allSections.filter((_, i) => i !== 1) : allSections;
  if (fits(withoutBranch)) return withoutBranch;
  return [allSections[modelIndex]];
}

export function Hud({ layout, collapsed }: { layout: HudLayout; collapsed: boolean }) {
  const { sections, legacyCorner, powerlineExtended } = layout;
  return (
    <TerminalFlex>
      {legacyCorner && !collapsed && (
        <TopLeftCorner color={hudSectionColors(sections[0], 0).backgroundColor} />
      )}
      {sections.map((section, index) => {
        const colors = hudSectionColors(section, index);
        const next = index + 1 < sections.length ? sections[index + 1] : null;
        return (
          <React.Fragment key={index}>
            <Span
              style={{
                color: colors.color,
                backgroundColor: colors.backgroundColor,
                borderLeft: collapsed && index === 0 ? "pill" : "none",
                borderColor: colors.backgroundColor,
              }}
            >
              {` ${section.text} `}
            </Span>
            {powerlineExtended && (
              <Span
                style={{
                  color: colors.backgroundColor,
                  backgroundColor: next
                    ? hudSectionColors(next, index + 1).backgroundColor
                    : MODAL_BACKGROUND_COLOR,
                }}
              >
                {DIVIDER}
              </Span>
            )}
          </React.Fragment>
        );
      })}
    </TerminalFlex>
  );
}

export function hudSectionColors(section: Section, index: number) {
  const colors = HUD_SECTION_COLORS[index] ?? HUD_SECTION_COLORS[HUD_SECTION_COLORS.length - 1];
  return {
    color: section.overrideForegroundColor ?? colors.color,
    backgroundColor: section.overrideBackgroundColor ?? colors.backgroundColor,
  };
}

function stripWidth(sections: Section[], leftCap: boolean, rightCaps: boolean): number {
  let width = leftCap ? 1 : 0;
  for (const section of sections) width += section.text.length + 2;
  if (rightCaps) width += sections.length;
  return width;
}

function contextBackgroundColor(percentUsed: number): string | null {
  if (percentUsed > 0.75) return HUD_CONTEXT_DANGER_BACKGROUND_COLOR;
  if (percentUsed > 0.65) return HUD_CONTEXT_WARNING_BACKGROUND_COLOR;
  return null;
}

function useTerminalCols(): number {
  const { paintCannon } = useApp();
  const [cols, setCols] = useState(() => paintCannon.terminalSize.cols);
  useEffect(() => {
    const listener = (event: TerminalResizeEvent) => setCols(event.cols);
    paintCannon.addEventListener("resize", listener);
    return () => {
      paintCannon.removeEventListener("resize", listener);
    };
  }, [paintCannon]);
  return cols;
}

export function displayCwd(cwd: string, home: string | null): string {
  if (home == null || home === "") return cwd;
  if (cwd === home) return "~";
  const prefix = home.endsWith("/") ? home : `${home}/`;
  if (!cwd.startsWith(prefix)) return cwd;
  return `~/${cwd.slice(prefix.length)}`;
}

export function truncateEnd(text: string, max: number): string {
  if (text.length <= max) return text;
  return text.slice(0, max - 3) + "...";
}

// Collapses middle path segments: ~/deep/down/into/the/abyss -> ~/deep/.../abyss.
export function truncateCwd(display: string, max: number): string {
  if (display.length <= max) return display;
  const segments = display.split("/");
  if (segments.length <= 3) return truncateEnd(display, max);
  const first = segments[0];
  let tail = segments[segments.length - 1];
  for (let i = segments.length - 2; i >= 1; i--) {
    const candidate = `${segments[i]}/${tail}`;
    if (`${first}/.../${candidate}`.length > max) break;
    tail = candidate;
  }
  const result = `${first}/.../${tail}`;
  if (result.length > max) return truncateEnd(result, max);
  return result;
}
