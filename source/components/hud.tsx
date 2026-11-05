import React, { useEffect, useMemo, useState } from "react";
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
import { useGitBranch } from "../hooks/use-git-branch.ts";
import { usePowerlineFont } from "../hooks/use-powerline-font.ts";
import { useLegacyComputingSymbols } from "../hooks/use-legacy-computing-symbols.ts";
import { useTransport } from "../transport-context.ts";
import { getEnvVar } from "../transports/transport-common.ts";

const MAX_MODEL_CHARS = 24;
const MAX_CWD_CHARS = 36;
const MAX_BRANCH_CHARS = 28;

// Room for the always-visible Ctrl+p hint on the strip next to the HUD, plus slack for
// row chrome we don't measure directly.
const HINT_COLS = 32;

const DIVIDER = String.fromCodePoint(0xe0b4); // powerline right-pointing rounded cap
const LEFT_CORNER = String.fromCodePoint(0x1fb41); // legacy computing smooth top-left corner
const BRANCH_ICON = String.fromCodePoint(0xe0a0); // powerline git branch glyph
const ROBOT_ICON = String.fromCodePoint(0xee0d); // nerd font robot glyph

type Section = {
  text: string;
  color: string;
  backgroundColor: string;
};

type HudLayout = {
  sections: Section[];
  legacyCorner: boolean;
  powerlineExtended: boolean;
};

export function useHudLayout(syntheticModels: SyntheticModel[]): HudLayout | null {
  const model = useModel();
  const cwd = useCwd();
  const branch = useGitBranch();
  const powerline = usePowerlineFont();
  const powerlineExtended = usePowerlineFont("powerline-extended");
  const materialDesign = usePowerlineFont("material-design");
  const legacyCorner = useLegacyComputingSymbols();
  const home = useHomeDir();
  const cols = useTerminalCols();
  const sessionMode = useAppStore(state => state.sessionMode);
  const history = useAppStore(state => state.history);

  const percentUsed = useMemo(() => {
    if (sessionMode.mode !== "live") return null;
    const used = sessionMode.trajectory.instance.primaryAgentApproximateContext();
    return Math.min(1, used / model.context);
  }, [sessionMode, history, model]);

  const allSections: Section[] = [];
  allSections.push({
    text: truncateCwd(displayCwd(cwd, home), MAX_CWD_CHARS),
    color: HUD_LIGHT_TEXT_COLOR,
    backgroundColor: HUD_CWD_BACKGROUND_COLOR,
  });
  if (branch != null) {
    const icon = powerline ? `${BRANCH_ICON} ` : "";
    allSections.push({
      text: truncateEnd(`${icon}${branch}`, MAX_BRANCH_CHARS),
      color: HUD_LIGHT_TEXT_COLOR,
      backgroundColor: HUD_BRANCH_BACKGROUND_COLOR,
    });
  }
  const modelIcon = materialDesign ? `${ROBOT_ICON}  ` : "";
  allSections.push({
    text: truncateEnd(`${modelIcon}${modelDisplayName(model, syntheticModels)}`, MAX_MODEL_CHARS),
    color: HUD_LIGHT_TEXT_COLOR,
    backgroundColor: HUD_MODEL_BACKGROUND_COLOR,
  });
  if (percentUsed != null && Math.round(percentUsed * 100) > 0) {
    allSections.push({
      text: `${Math.round(percentUsed * 100)}% ctx`,
      color: HUD_DARK_TEXT_COLOR,
      backgroundColor: contextBackgroundColor(percentUsed),
    });
  }

  const fits = (sections: Section[]) =>
    stripWidth(sections, legacyCorner, powerlineExtended) <= cols - HINT_COLS;
  let sections = allSections;
  // Narrow terminal? Drop the branch first, then hide the HUD entirely if it still wraps.
  if (branch != null && !fits(sections)) sections = allSections.filter((_, i) => i !== 1);
  if (!fits(sections)) return null;
  return { sections, legacyCorner, powerlineExtended };
}

export function Hud({ layout, collapsed }: { layout: HudLayout; collapsed: boolean }) {
  const { sections, legacyCorner, powerlineExtended } = layout;
  return (
    <TerminalFlex>
      {legacyCorner && !collapsed && (
        <Span style={{ color: sections[0].backgroundColor }}>{LEFT_CORNER}</Span>
      )}
      {sections.map((section, index) => {
        const next = index + 1 < sections.length ? sections[index + 1] : null;
        return (
          <React.Fragment key={index}>
            <Span
              style={{
                color: section.color,
                backgroundColor: section.backgroundColor,
                borderLeft: collapsed && index === 0 ? "pill" : "none",
                borderColor: section.backgroundColor,
              }}
            >
              {` ${section.text} `}
            </Span>
            {powerlineExtended && (
              <Span
                style={{
                  color: section.backgroundColor,
                  backgroundColor: next ? next.backgroundColor : MODAL_BACKGROUND_COLOR,
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

function stripWidth(sections: Section[], leftCap: boolean, rightCaps: boolean): number {
  let width = leftCap ? 1 : 0;
  for (const section of sections) width += section.text.length + 2;
  if (rightCaps) width += sections.length;
  return width;
}

function contextBackgroundColor(percentUsed: number): string {
  if (percentUsed > 0.75) return HUD_CONTEXT_DANGER_BACKGROUND_COLOR;
  if (percentUsed > 0.65) return HUD_CONTEXT_WARNING_BACKGROUND_COLOR;
  return HUD_CONTEXT_BACKGROUND_COLOR;
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

function useHomeDir(): string | null {
  const transport = useTransport();
  const [home, setHome] = useState<string | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    void getEnvVar(controller.signal, transport, "HOME", 5000).then(result => {
      if (controller.signal.aborted || !result.success || result.data === "") return;
      setHome(result.data);
    });
    return () => controller.abort();
  }, [transport]);
  return home;
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
