import type { UserMessage } from "../llm-ir.ts";

export function subagentPrompt(task: UserMessage["content"]): UserMessage["content"] {
  return [
    {
      type: "text",
      content: `You are a subagent of a primary agent. You can't talk to the user directly. You can only either:
1. call tools, or
2. respond to the primary agent.

You must ONLY respond to the primary agent once you're done with your task, or have determined your task is impossible. Until then, use your tools to complete the task the primary agent has given to you.

The primary agent has given you the following task:\n`,
    },
    ...task,
    {
      type: "text",
      content: `\nRemember, you must ONLY respond to the primary agent once you're done with your task or have determined your task is impossible. Until then, use your tools to complete the task. You cannot ask clarifying questions or talk to the user, you can only call tools or respond to the primary agent when you're done. Follow the task specifically: don't do unrelated work. Once you think you're done, respond to the primary agent with the result.`,
    },
  ];
}

export function toolSkip(reason: string) {
  return `
Tool was skipped and didn't run. The reason for skipping the tool was:
${reason}
`.trim();
}

export function imageAttachmentPlaceholderText() {
  return "[An image was attached here. Since images are not supported by your model, the source to the image is omitted. There might be future context that allows you to make a guess about what the image was, so keep that in mind as you process the rest of the messages.]";
}

export function toolImageOutputPreamble() {
  return "The tool call above returned the following image:";
}

export function openTag(tag: string, attrs?: Record<string, string>) {
  if (!attrs || Object.keys(attrs).length === 0) return "<" + tag + ">";

  const attrString = Object.entries(attrs)
    .map(([key, value]) => `${key}="${value}"`)
    .join(" ");

  return "<" + tag + " " + attrString + ">";
}

export function closeTag(tag: string) {
  return "</" + tag + ">";
}

export function tagged(tag: string, attrs: Record<string, string> = {}, ...content: string[]) {
  return openTag(tag, attrs) + content.join("") + closeTag(tag);
}
