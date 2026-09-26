import React from "react";
import path from "path";
import { FirstTimeSetup } from "../source/first-time-setup.tsx";
import { runDemo, type DemoProps } from "./run-demo.tsx";

function FirstTimeSetupDemo({ directory }: DemoProps) {
  return <FirstTimeSetup configPath={path.join(directory, "octofriend.json5")} />;
}

await runDemo(FirstTimeSetupDemo);
