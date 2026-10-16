import React from "react";
import { useApp } from "paintcannon-react";
import { ModelSetup } from "../source/components/auto-detect-models.tsx";
import { runDemo } from "./run-demo.tsx";

function SyntheticModelsUnavailable() {
  const { exit } = useApp();
  return (
    <ModelSetup
      syntheticModels={[]}
      config={null}
      titleOverride="Choose Synthetic to preview unavailable models"
      onComplete={exit}
      onCancel={exit}
      onOverrideDefaultApiKey={async () => {}}
    />
  );
}

await runDemo(fixtures => {
  const previous = process.env["SYNTHETIC_API_KEY"];
  process.env["SYNTHETIC_API_KEY"] = "demo-key";
  fixtures.defer(() => {
    if (previous === undefined) delete process.env["SYNTHETIC_API_KEY"];
    else process.env["SYNTHETIC_API_KEY"] = previous;
  });
  return <SyntheticModelsUnavailable />;
});
