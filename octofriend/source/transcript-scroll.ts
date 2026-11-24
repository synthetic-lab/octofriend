import { createContext, useContext } from "react";

export type ScrollTranscriptToBottomIfNeeded = () => boolean;

export const ScrollTranscriptToBottomContext = createContext<ScrollTranscriptToBottomIfNeeded>(
  () => false,
);

export function useScrollTranscriptToBottom(): ScrollTranscriptToBottomIfNeeded {
  return useContext(ScrollTranscriptToBottomContext);
}
