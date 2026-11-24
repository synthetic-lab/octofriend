import React, { useState } from "react";
import { render } from "paintcannon-react";
import { KbShortcutPanel } from "../source/components/kb-select/kb-shortcut-panel.tsx";
import type { Keymap } from "../source/components/kb-select/kb-shortcut-select.tsx";
import { TerminalFlex } from "../source/components/terminal-flex.tsx";
import { KeyboardProvider } from "../source/hooks/use-keyboard.ts";
import { FOREGROUND_COLOR } from "../source/theme.ts";

type Section = "starter" | "web" | "cli";
type Selection =
  | { type: "template"; name: string }
  | { type: "section"; section: Section }
  | { type: "back" };

const templateGroups: { [K in Section]: { title: string; templates: string[] } } = {
  starter: {
    title: "Starter Templates",
    templates: [
      "Blank Project",
      "Personal Website",
      "REST API",
      "Command-Line Tool",
      "Desktop App",
      "Mobile App",
      "Browser Extension",
      "Background Worker",
      "Shared Library",
      "Chat Bot",
      "Data Pipeline",
      "Game Prototype",
      "Automation Script",
    ],
  },
  web: {
    title: "Web Templates",
    templates: [
      "Landing Page",
      "Blog",
      "Portfolio",
      "Documentation",
      "Dashboard",
      "Online Store",
      "Event Page",
      "Photo Gallery",
      "Community Forum",
      "Booking App",
      "Recipe Collection",
      "Job Board",
      "Status Page",
    ],
  },
  cli: {
    title: "CLI Templates",
    templates: [
      "File Organizer",
      "Task Runner",
      "Log Viewer",
      "Backup Utility",
      "Batch Renamer",
      "CSV Converter",
      "Directory Sync",
      "Archive Manager",
      "HTTP Client",
      "Markdown Previewer",
      "Image Resizer",
      "Checksum Verifier",
      "Release Helper",
    ],
  },
};

function Demo({ onExit }: { onExit: () => void }) {
  const [activeSection, setActiveSection] = useState<Section>("starter");
  const activeGroup = templateGroups[activeSection];
  const actions: Keymap<Selection> = {};
  if (activeSection !== "starter") {
    actions.s = {
      label: templateGroups.starter.title,
      value: { type: "section", section: "starter" },
    };
  }
  if (activeSection !== "web") {
    actions.w = { label: templateGroups.web.title, value: { type: "section", section: "web" } };
  }
  if (activeSection !== "cli") {
    actions.c = { label: templateGroups.cli.title, value: { type: "section", section: "cli" } };
  }
  actions.b = { label: "Back", value: { type: "back" } };

  return (
    <TerminalFlex style={{ flexDirection: "column", padding: 1, height: "100%", gap: 1 }}>
      <KbShortcutPanel<Selection>
        key={activeSection}
        shortcutItems={[
          {
            type: "sections",
            sections: [
              {
                id: activeSection,
                title: activeGroup.title,
                order: activeGroup.templates.map(name => ({
                  label: name,
                  value: { type: "template", name },
                })),
              },
            ],
          },
        ]}
        actions={actions}
        onSelect={({ value }) => {
          switch (value.type) {
            case "template":
              break;
            case "section":
              setActiveSection(value.section);
              break;
            case "back":
              if (activeSection === "starter") onExit();
              else setActiveSection("starter");
              break;
          }
        }}
      />
    </TerminalFlex>
  );
}

const root = render(
  <KeyboardProvider>
    <Demo onExit={() => root.unmount()} />
  </KeyboardProvider>,
  { alternateScreen: true, captureMouse: false, captureCtrlC: false },
);
root.container.style.color = FOREGROUND_COLOR;
