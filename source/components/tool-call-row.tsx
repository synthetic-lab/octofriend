import React from "react";
import { Span } from "paintcannon-react";
import { SHIMMER_HIGHLIGHT_COLOR, TOOL_LABEL_COLOR, useColor } from "../theme.ts";
import { TerminalFlex } from "./terminal-flex.tsx";
import PausableLineSpinner from "./pausable-line-spinner.tsx";
import Shimmer, { type ShimmerSegment } from "./shimmer.tsx";
import { useShimmerlock } from "../hooks/use-shimmerlock.ts";

export type ToolCallActivity = "static" | "pending" | "running";

export function ToolCallRow({
  name,
  details,
  activity,
}: {
  name: string;
  details?: string;
  activity: ToolCallActivity;
}) {
  const themeColor = useColor();
  const hasLongDetails = details != null && details.length >= 20;
  const segments: Array<ShimmerSegment> =
    details == null
      ? [{ text: name, from: themeColor, to: SHIMMER_HIGHLIGHT_COLOR }]
      : [
          { text: `${name}: `, from: TOOL_LABEL_COLOR, to: SHIMMER_HIGHLIGHT_COLOR },
          ...(hasLongDetails
            ? []
            : [{ text: details, from: themeColor, to: SHIMMER_HIGHLIGHT_COLOR }]),
        ];

  return (
    <TerminalFlex>
      <Span style={{ flexShrink: 0 }}>
        <PausableLineSpinner running={activity === "running"} />{" "}
      </Span>
      <Span style={{ minWidth: 0, overflowWrap: "anywhere" }}>
        {activity === "running" ? (
          <LiveToolText segments={segments} />
        ) : (
          segments.map((segment, index) => (
            <Span key={index} style={{ color: segment.from }}>
              {segment.text}
            </Span>
          ))
        )}
        {hasLongDetails && <Span style={{ color: themeColor }}>{details}</Span>}
      </Span>
    </TerminalFlex>
  );
}

function LiveToolText({ segments }: { segments: Array<ShimmerSegment> }) {
  const lock = useShimmerlock("primary-tool");
  return <Shimmer segments={segments} lock={lock} running />;
}
