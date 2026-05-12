import React from "react";
import { Box, Text } from "ink";
import { t } from "structural";
import { readFileSync } from "fs";
import { ToolCallItems } from "../history.ts";
import { ParsedToolSchemaFrom } from "../tools/common.ts";
import { countLines } from "../str.ts";
import { useColor } from "../theme.ts";
import shell from "../tools/tool-defs/bash.ts";
import read from "../tools/tool-defs/read.ts";
import list from "../tools/tool-defs/list.ts";
import edit, { ParsedSchema as EditParsedSchema } from "../tools/tool-defs/edit.ts";
import append from "../tools/tool-defs/append.ts";
import prepend from "../tools/tool-defs/prepend.ts";
import rewrite from "../tools/tool-defs/rewrite.ts";
import createTool from "../tools/tool-defs/create.ts";
import mcp from "../tools/tool-defs/mcp.ts";
import fetchTool from "../tools/tool-defs/fetch.ts";
import skill from "../tools/tool-defs/skill.ts";
import webSearch from "../tools/tool-defs/web-search.ts";
import glob from "../tools/tool-defs/glob.ts";
import grep from "../tools/tool-defs/grep.ts";
import { DiffRenderer } from "./diff-renderer.tsx";
import { FileRenderer } from "./file-renderer.tsx";
import { LspToolRenderer } from "./lsp-tool-renderer.tsx";

export function ToolMessageRenderer({ item }: { item: ToolCallItems["tools"][number] }) {
  if (item.type === "malformed-request") {
    return null;
  }
  switch (item.call.parsed.name) {
    case "read":
      return <ReadToolRenderer item={item.call.parsed} />;
    case "list":
      return <ListToolRenderer item={item.call.parsed} />;
    case "shell":
      return <ShellToolRenderer item={item.call.parsed} />;
    case "edit":
      return <EditToolRenderer item={item.call.parsed} />;
    case "create":
      return <CreateToolRenderer item={item.call.parsed} />;
    case "mcp":
      return <McpToolRenderer item={item.call.parsed} />;
    case "fetch":
      return <FetchToolRenderer item={item.call.parsed} />;
    case "append":
      return <AppendToolRenderer item={item.call.parsed} />;
    case "prepend":
      return <PrependToolRenderer item={item.call.parsed} />;
    case "rewrite":
      return <RewriteToolRenderer item={item.call.parsed} />;
    case "skill":
      return <SkillToolRenderer item={item.call.parsed} />;
    case "web-search":
      return <WebSearchToolRenderer item={item.call.parsed} />;
    case "glob":
      return <GlobRenderer item={item.call.parsed} />;
    case "grep":
      return <GrepRenderer item={item.call.parsed} />;
    case "lsp-definition":
    case "lsp-references":
    case "lsp-hover":
    case "lsp-diagnostics":
    case "lsp-document-symbol":
    case "lsp-implementation":
    case "lsp-incoming-calls":
    case "lsp-outgoing-calls":
      return <LspToolRenderer item={item.call.parsed} />;
  }
}

function GlobRenderer({ item }: { item: ParsedToolSchemaFrom<typeof glob> }) {
  return (
    <Box flexDirection="column">
      <Text color="gray">Octo searched for files using a glob pattern:</Text>
      <GlobArg name="CWD" arg={item.arguments.cwd} />
      <GlobArg name="Filename pattern" arg={item.arguments.name} />
      <GlobArg name="Path pattern" arg={item.arguments.path} />
      <GlobArg name="Max depth" arg={item.arguments.maxDepth} />
    </Box>
  );
}

function GrepRenderer({ item }: { item: ParsedToolSchemaFrom<typeof grep> }) {
  return (
    <Box flexDirection="column">
      <Text color="gray">Octo searched file contents:</Text>
      <GlobArg name="Pattern" arg={item.arguments.pattern} />
      <GlobArg name="Path" arg={item.arguments.path} />
      <GlobArg name="Case insensitive" arg={item.arguments.caseInsensitive} />
      <GlobArg name="Context lines" arg={item.arguments.context} />
      <GlobArg name="Max results" arg={item.arguments.maxResults} />
      <GlobArg name="Timeout" arg={item.arguments.timeout} />
    </Box>
  );
}

function GlobArg({ name, arg }: { name: string; arg: string | number | boolean | undefined }) {
  const color = useColor();
  if (arg == null) return null;
  return (
    <Text>
      <Text color="gray">{name}:</Text> <Text color={color}>{arg}</Text>
    </Text>
  );
}

function WebSearchToolRenderer(_: { item: ParsedToolSchemaFrom<typeof webSearch> }) {
  return (
    <Box>
      <Text color="gray">Octo searched the web</Text>
    </Box>
  );
}

function SkillToolRenderer({ item }: { item: ParsedToolSchemaFrom<typeof skill> }) {
  return (
    <Box>
      <Text color="gray">Octo read the {item.arguments.skillName} skill</Text>
    </Box>
  );
}

function AppendToolRenderer({ item }: { item: ParsedToolSchemaFrom<typeof append> }) {
  const { filePath, text } = item.arguments;

  let startLineNr = 1;
  try {
    const file = readFileSync(filePath, "utf8");
    const lines = countLines(file);
    startLineNr = lines + 1;
  } catch {
    return null;
  }

  const renderedFile = (
    <FileRenderer contents={text} filePath={filePath} startLineNr={startLineNr} />
  );
  if (!renderedFile) return null;

  return (
    <Box flexDirection="column" gap={1}>
      <Text>Octo wants to add the following to the end of the file:</Text>
      {renderedFile}
    </Box>
  );
}

function FetchToolRenderer({ item }: { item: ParsedToolSchemaFrom<typeof fetchTool> }) {
  const themeColor = useColor();
  return (
    <Box>
      <Text color="gray">{item.name}: </Text>
      <Text color={themeColor}>{item.arguments.url}</Text>
    </Box>
  );
}

function ShellToolRenderer({ item }: { item: ParsedToolSchemaFrom<typeof shell> }) {
  const themeColor = useColor();
  return (
    <Box flexDirection="column">
      <Box>
        <Text color="gray">{item.name}: </Text>
        <Text color={themeColor}>{item.arguments.cmd}</Text>
      </Box>
      <Text color="gray">timeout: {item.arguments.timeout}</Text>
    </Box>
  );
}

function ReadToolRenderer({ item }: { item: ParsedToolSchemaFrom<typeof read> }) {
  const themeColor = useColor();
  return (
    <Box>
      <Text color="gray">{item.name}: </Text>
      <Text color={themeColor}>{item.arguments.filePath}</Text>
    </Box>
  );
}

function ListToolRenderer({ item }: { item: ParsedToolSchemaFrom<typeof list> }) {
  const themeColor = useColor();
  return (
    <Box>
      <Text color="gray">{item.name}: </Text>
      <Text color={themeColor}>{item?.arguments?.dirPath || process.cwd()}</Text>
    </Box>
  );
}

function EditToolRenderer({ item }: { item: ParsedToolSchemaFrom<typeof edit> }) {
  const themeColor = useColor();
  return (
    <Box flexDirection="column">
      <Box>
        <Text>Edit: </Text>
        <Text color={themeColor}>{item.arguments.filePath}</Text>
      </Box>
      <DiffEditRenderer filePath={item.arguments.filePath} item={item.arguments} />
    </Box>
  );
}

function PrependToolRenderer({ item }: { item: ParsedToolSchemaFrom<typeof prepend> }) {
  const { text, filePath } = item.arguments;
  return (
    <Box flexDirection="column" gap={1}>
      <Text>Octo wants to add the following to the beginning of the file:</Text>
      <FileRenderer contents={text} filePath={filePath} />
    </Box>
  );
}

function RewriteToolRenderer({ item }: { item: ParsedToolSchemaFrom<typeof rewrite> }) {
  const { text, filePath, originalFileContents } = item.arguments;

  return (
    <Box flexDirection="column" gap={1}>
      <Text>Octo wants to rewrite the file:</Text>
      <DiffRenderer
        oldText={originalFileContents}
        newText={text}
        fileContents={originalFileContents}
        filepath={filePath}
      />
    </Box>
  );
}

function DiffEditRenderer({
  item,
  filePath,
}: {
  item: t.GetType<typeof EditParsedSchema>;
  filePath: string;
}) {
  return (
    <Box flexDirection="column">
      <Text>Octo wants to make the following changes:</Text>
      <DiffRenderer
        oldText={item.search}
        newText={item.replace}
        fileContents={item.originalFileContents}
        filepath={filePath}
      />
    </Box>
  );
}

function CreateToolRenderer({ item }: { item: ParsedToolSchemaFrom<typeof createTool> }) {
  const themeColor = useColor();
  return (
    <Box flexDirection="column" gap={1}>
      <Box>
        <Text>Octo wants to create </Text>
        <Text color={themeColor}>{item.arguments.filePath}</Text>
        <Text>:</Text>
      </Box>
      <Box>
        <FileRenderer contents={item.arguments.content} filePath={item.arguments.filePath} />
      </Box>
    </Box>
  );
}

function McpToolRenderer({ item }: { item: ParsedToolSchemaFrom<typeof mcp> }) {
  const themeColor = useColor();
  return (
    <Box flexDirection="column">
      <Box>
        <Text color="gray">{item.name}: </Text>
        <Text color={themeColor}>
          Server: {item.arguments.server}, Tool: {item.arguments.tool}
        </Text>
      </Box>
      <Text color="gray">Arguments: {JSON.stringify(item.arguments.arguments)}</Text>
    </Box>
  );
}
