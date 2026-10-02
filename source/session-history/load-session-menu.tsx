import React, { useCallback, useContext, useMemo, useState } from "react";
import { Span } from "paintcannon-react";
import { useShallow } from "zustand/react/shallow";
import { MenuHeader } from "../components/kb-select/kb-shortcut-panel.tsx";
import {
  KbShortcutTable,
  type KbShortcutTableCellProps,
  type KbShortcutTableColumn,
} from "../components/kb-select/kb-shortcut-table.tsx";
import { TerminalFlex } from "../components/terminal-flex.tsx";
import { useCwd } from "../hooks/use-cwd.tsx";
import { useSession } from "../session-context.ts";
import { TransportContext } from "../transport-context.ts";
import { useConfig } from "../config.ts";
import { useAppStore } from "../state.ts";
import { useColor } from "../theme.ts";
import { listPreviousSessions, loadSession, type Session } from "./index.ts";
import {
  SESSION_PREVIEW_HEADER,
  SESSION_UPDATED_HEADER,
  sessionListTable,
  type SessionListRow,
} from "./session-list.ts";

type Props = {
  onBack: () => void;
};

const SESSION_COLUMNS: Array<KbShortcutTableColumn<SessionListRow>> = [
  {
    heading: SESSION_PREVIEW_HEADER,
    Cell: SessionPreviewCell,
  },
  {
    heading: SESSION_UPDATED_HEADER,
    Cell: SessionUpdatedCell,
  },
];

export function LoadSessionMenu({ onBack }: Props) {
  const cwd = useCwd();
  const currentSession = useSession();
  const [error, setError] = useState<string | null>(null);
  const { closeMenu, setQuery, hydrate } = useAppStore(
    useShallow(state => ({
      closeMenu: state.closeMenu,
      setQuery: state.setQuery,
      hydrate: state.sessionMode.mode === "live" ? state.sessionMode.control.hydrate : null,
    })),
  );
  const config = useConfig();
  const transport = useContext(TransportContext);
  const rows = useMemo(
    () => sessionListTable(listPreviousSessions(cwd, currentSession.metadata.sessionId)).rows,
    [currentSession.metadata.sessionId, cwd],
  );

  const load = useCallback(
    async (row: SessionListRow) => {
      if (hydrate == null) return;
      const loaded = loadSession(row.sessionId);
      if (loaded == null) {
        setError(`Session ${row.sessionId} no longer exists.`);
        return;
      }

      const nextSession: Session = {
        ...loaded.session,
        metadata: {
          ...loaded.session.metadata,
          cliArgs: currentSession.metadata.cliArgs,
        },
      };
      setQuery("");
      await hydrate({
        session: nextSession,
        history: loaded.history,
        config,
        transport,
      });
      onBack();
      closeMenu();
    },
    [closeMenu, currentSession.metadata.cliArgs, hydrate, onBack, setQuery, config, transport],
  );

  return (
    <TerminalFlex
      style={{
        flexDirection: "column",
      }}
    >
      <MenuHeader title="Load previous session" />
      <TerminalFlex
        style={{
          justifyContent: "center",
        }}
      >
        <TerminalFlex
          style={{
            flexDirection: "column",
          }}
        >
          {rows.length === 0 && (
            <Span style={{ color: "gray" }}>No saved sessions found for this directory.</Span>
          )}
          <KbShortcutTable
            rows={rows}
            columns={SESSION_COLUMNS}
            getRowKey={row => row.sessionId}
            onSelect={load}
            actions={[
              {
                shortcut: "b",
                label: "Back to main menu",
                onSelect: onBack,
              },
            ]}
          />
          {error && <Span style={{ color: "red" }}>{error}</Span>}
        </TerminalFlex>
      </TerminalFlex>
    </TerminalFlex>
  );
}

function SessionPreviewCell({ row, isSelected }: KbShortcutTableCellProps<SessionListRow>) {
  const themeColor = useColor();
  return (
    <TerminalFlex style={{ minWidth: 40 }}>
      <Span style={isSelected ? { color: themeColor } : undefined}>{row.preview ?? ""}</Span>
    </TerminalFlex>
  );
}

function SessionUpdatedCell({ row, isSelected }: KbShortcutTableCellProps<SessionListRow>) {
  return <Span style={isSelected ? undefined : { color: "gray" }}>{row.updatedAtText}</Span>;
}
