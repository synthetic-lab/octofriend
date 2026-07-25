import React, { useEffect, useState } from "react";
import { Span } from "paintcannon-react";
import { useKeyboard } from "../../hooks/use-keyboard.ts";
import { TABLE_SELECTED_ROW_BACKGROUND_COLOR } from "../../theme.ts";
import { IndicatorComponent } from "../select.tsx";
import { TerminalFlex } from "../terminal-flex.tsx";

export type KbShortcutTableCellProps<Row> = {
  row: Row;
  isSelected: boolean;
};

export type KbShortcutTableColumn<Row> = {
  heading: string;
  Cell: React.ComponentType<KbShortcutTableCellProps<Row>>;
};

export type KbShortcutTableAction = {
  shortcut: string;
  label: React.ReactNode;
  onSelect: () => void;
};

type Props<Row> = {
  rows: Row[];
  columns: Array<KbShortcutTableColumn<Row>>;
  getRowKey: (row: Row) => React.Key;
  onSelect: (row: Row) => void;
  actions?: KbShortcutTableAction[];
};

const PAGE_SIZE = 10;

export function KbShortcutTable<Row>({
  rows,
  columns,
  getRowKey,
  onSelect,
  actions = [],
}: Props<Row>) {
  const [page, setPage] = useState(0);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const pageCount = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  const pageStart = page * PAGE_SIZE;
  const visibleRows = rows.slice(pageStart, pageStart + PAGE_SIZE);

  useEffect(() => {
    setPage(current => Math.min(current, pageCount - 1));
    setSelectedIndex(0);
  }, [pageCount, rows.length]);

  useKeyboard(event => {
    if (event.ctrlKey) return;

    const action = actions.find(candidate => candidate.shortcut === event.key);
    if (action) {
      event.preventDefault();
      action.onSelect();
      return;
    }

    if (event.key === "h" && page > 0) {
      event.preventDefault();
      setPage(current => current - 1);
      setSelectedIndex(0);
      return;
    }
    if (event.key === "l" && page < pageCount - 1) {
      event.preventDefault();
      setPage(current => current + 1);
      setSelectedIndex(0);
      return;
    }
    if (event.key === "k" || event.key === "ArrowUp") {
      event.preventDefault();
      setSelectedIndex(current => Math.max(0, current - 1));
      return;
    }
    if (event.key === "j" || event.key === "ArrowDown") {
      event.preventDefault();
      setSelectedIndex(current => Math.min(visibleRows.length - 1, current + 1));
      return;
    }
    if (/^[0-9]$/.test(event.key)) {
      const row = visibleRows[Number.parseInt(event.key, 10)];
      if (row !== undefined) {
        event.preventDefault();
        onSelect(row);
      }
      return;
    }
    if (event.key === "Enter") {
      const row = visibleRows[selectedIndex];
      if (row !== undefined) {
        event.preventDefault();
        onSelect(row);
      }
    }
  });

  const actionRowStart = visibleRows.length + (rows.length > 0 ? 2 : 1);
  return (
    <TerminalFlex
      style={{
        display: "grid",
        gridTemplateColumns: ["max-content", ...columns.map(() => "max-content")].join(" "),
        gridAutoRows: "max-content",
        columnGap: 2,
      }}
    >
      {rows.length > 0 && (
        <>
          {columns.map((column, columnIndex) => (
            <TerminalFlex
              key={columnIndex}
              style={{
                gridColumn: columnIndex === 0 ? "1 / span 2" : columnIndex + 2,
                gridRow: 1,
              }}
            >
              <TerminalFlex
                style={{
                  flexGrow: 1,
                  minWidth: 0,
                  marginLeft: columnIndex === 0 ? 2 : 0,
                  borderBottom: "solid",
                  borderColor: "gray",
                }}
              >
                <Span style={{ color: "gray" }}>{column.heading}</Span>
              </TerminalFlex>
            </TerminalFlex>
          ))}
        </>
      )}
      {visibleRows.map((row, rowIndex) => {
        const isSelected = rowIndex === selectedIndex;
        const gridRow = rowIndex + 2;
        const backgroundColor = isSelected ? TABLE_SELECTED_ROW_BACKGROUND_COLOR : undefined;
        return (
          <React.Fragment key={getRowKey(row)}>
            {backgroundColor && (
              <TerminalFlex
                style={{
                  gridColumn: "1 / -1",
                  gridRow,
                  backgroundColor,
                }}
              />
            )}
            <TerminalFlex
              style={{
                gridColumn: 1,
                gridRow,
                flexWrap: "nowrap",
                backgroundColor,
              }}
            >
              <IndicatorComponent isSelected={isSelected} />
              <Span style={{ color: "gray" }}>{rowIndex}:</Span>
            </TerminalFlex>
            {columns.map((column, columnIndex) => (
              <TerminalFlex
                key={columnIndex}
                style={{
                  gridColumn: columnIndex + 2,
                  gridRow,
                  minWidth: 0,
                  backgroundColor,
                }}
              >
                <column.Cell row={row} isSelected={isSelected} />
              </TerminalFlex>
            ))}
          </React.Fragment>
        );
      })}
      {page > 0 && <TableAction gridRow={actionRowStart} label="Previous page" shortcut="h" />}
      {page < pageCount - 1 && (
        <TableAction gridRow={actionRowStart + (page > 0 ? 1 : 0)} label="Next page" shortcut="l" />
      )}
      {actions.map((action, actionIndex) => (
        <TableAction
          key={action.shortcut}
          gridRow={
            actionRowStart + (page > 0 ? 1 : 0) + (page < pageCount - 1 ? 1 : 0) + actionIndex
          }
          label={action.label}
          shortcut={action.shortcut}
        />
      ))}
    </TerminalFlex>
  );
}

function TableAction({
  gridRow,
  label,
  shortcut,
}: {
  gridRow: number;
  label: React.ReactNode;
  shortcut: string;
}) {
  return (
    <TerminalFlex
      style={{
        gridColumn: "1 / -1",
        gridRow,
      }}
    >
      <TerminalFlex style={{ width: 5, flexShrink: 0 }} />
      <Span>{label}</Span>
      <Span> </Span>
      <Span style={{ color: "gray" }}>({shortcut})</Span>
    </TerminalFlex>
  );
}
