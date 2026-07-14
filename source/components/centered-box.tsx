import React from "react";
import { Div } from "paintcannon-react";
export const CenteredBox = ({ children }: { children?: React.ReactNode }) => {
  return (
    <Div
      style={{
        display: "flex",
        whiteSpace: "pre-wrap",
        flexDirection: "column",
        justifyContent: "center",
        alignItems: "center",
        height: "100%",
      }}
    >
      <Div
        style={{
          display: "flex",
          whiteSpace: "pre-wrap",
          flexDirection: "column",
          width: "100%",
          minWidth: 0,
          maxWidth: 80,
        }}
      >
        {children}
      </Div>
    </Div>
  );
};
export const HeightlessCenteredBox = ({ children }: { children?: React.ReactNode }) => {
  return (
    <Div
      style={{
        display: "flex",
        whiteSpace: "pre-wrap",
        flexDirection: "column",
        justifyContent: "center",
        alignItems: "center",
      }}
    >
      <Div
        style={{
          display: "flex",
          whiteSpace: "pre-wrap",
          flexDirection: "column",
          width: "100%",
          minWidth: 0,
          maxWidth: 80,
        }}
      >
        {children}
      </Div>
    </Div>
  );
};
