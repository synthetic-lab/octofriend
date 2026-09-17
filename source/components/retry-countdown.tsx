import React, { useEffect, useState } from "react";
import { Span } from "paintcannon-react";
import Spinner from "./spinner.tsx";
import { TerminalFlex } from "./terminal-flex.tsx";

export default function RetryCountdown({
  error,
  attempt,
  max,
  delayMs,
}: {
  error: string;
  attempt: number;
  max: number;
  delayMs: number;
}) {
  const [startedAt] = useState(() => Date.now());
  const [now, setNow] = useState(startedAt);

  useEffect(() => {
    const interval = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(interval);
  }, []);

  const secondsRemaining = Math.max(0, Math.ceil((startedAt + delayMs - now) / 1000));

  return (
    <TerminalFlex
      style={{
        flexDirection: "column",
      }}
    >
      <TerminalFlex>
        <Span
          style={{
            color: "red",
          }}
        >
          <Spinner type="binary" />
        </Span>
        <Span> </Span>
        <Span
          style={{
            color: "red",
          }}
        >
          Request failed (retry {attempt}/{max} in {secondsRemaining}s)
        </Span>
      </TerminalFlex>
      <Span
        style={{
          color: "gray",
        }}
      >
        {error}
      </Span>
    </TerminalFlex>
  );
}
