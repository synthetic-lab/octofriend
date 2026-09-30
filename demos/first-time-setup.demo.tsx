import React from "react";
import path from "path";
import { FirstTimeSetup } from "../source/first-time-setup.tsx";
import { runDemo } from "./run-demo.tsx";
import { temporaryDirectory } from "./temporary-directory.ts";

await runDemo(async fixtures => {
  const { path: directory } = fixtures.use(await temporaryDirectory());
  return <FirstTimeSetup configPath={path.join(directory, "octofriend.json5")} />;
});
