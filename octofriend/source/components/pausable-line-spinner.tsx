import React from "react";
import { Span } from "paintcannon-react";
import Spinner from "./spinner.tsx";

function PausableLineSpinner({ running }: { running: boolean }) {
  return <Span style={{ color: "gray" }}>{running ? <Spinner type="line" /> : "-"}</Span>;
}

export default React.memo(PausableLineSpinner);
