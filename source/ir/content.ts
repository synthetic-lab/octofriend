import type { Content } from "../libocto/llm-ir.ts";

export function textContent(content: string): Content["content"] {
  return [{ type: "text", content }];
}

export function contentToText(content: Content["content"]): string {
  return content
    .map(part => {
      if (part.type === "text") return part.content;
      return `Image file: ${part.image.filePath}`;
    })
    .join("\n");
}
