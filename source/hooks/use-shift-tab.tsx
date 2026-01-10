import { useInput } from "ink";

export function useShiftTab(callback: () => void) {
  useInput((input, key) => {
    if (key.shift && key.tab) {
      callback();
    }
  });
}
