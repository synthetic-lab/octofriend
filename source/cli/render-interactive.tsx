import React from "react";
import { render, type CreateRootOptions } from "paintcannon-react";
import { KeyboardProvider } from "../hooks/use-keyboard.ts";
import { ToastProvider } from "../components/toast.tsx";
import { FOREGROUND_COLOR } from "../theme.ts";
import * as logger from "../logger.ts";

const INTERACTIVE_RENDER_OPTIONS = {
  alternateScreen: true,
  captureMouse: true,
  captureCtrlC: true,
} satisfies CreateRootOptions;

export async function renderInteractive(
  element: React.ReactNode,
  options: { captureCtrlC: boolean },
) {
  logger.startBuffering();
  try {
    const root = render(
      <ToastProvider>
        <KeyboardProvider>{element}</KeyboardProvider>
      </ToastProvider>,
      {
        ...INTERACTIVE_RENDER_OPTIONS,
        captureCtrlC: options.captureCtrlC,
      },
    );
    root.container.style.position = "relative";
    root.container.style.overflowX = "hidden";
    root.container.style.color = FOREGROUND_COLOR;
    await root.waitUntilExit();
  } finally {
    // waitUntilExit settles once paintcannon has handed the tty back, so this
    // is the first moment the buffered logs can safely be written.
    logger.stopBuffering();
    logger.drain();
  }
}
