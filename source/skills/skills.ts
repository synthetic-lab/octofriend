import path from "path";
import { parse as parseYaml } from "yaml";
import { Transport, getEnvVar } from "../transports/transport-common.ts";

const SKILL_FILE_NAME = "SKILL.md";
const MAX_NAME_LENGTH = 64;
const MAX_DESCRIPTION_LENGTH = 1024;
const MAX_COMPATIBILITY_LENGTH = 500;

const NAME_PATTERN = /^[a-zA-Z0-9]+(-[a-zA-Z0-9]+)*$/;

export type Skill = {
  name: string;
  description: string;
  license?: string;
  compatibility?: string;
  metadata?: Record<string, string>;
  instructions: string;
  path: string;
  skillFilePath: string;
};

type SkillFrontmatter = {
  name?: string;
  description?: string;
  license?: string;
  compatibility?: string;
  metadata?: Record<string, string>;
};

export function validateSkill(skill: Skill): string[] {
  const errors: string[] = [];

  if (!skill.name) {
    errors.push("name is required");
  } else {
    if (skill.name.length > MAX_NAME_LENGTH) {
      errors.push(`name exceeds ${MAX_NAME_LENGTH} characters`);
    }
    if (!NAME_PATTERN.test(skill.name)) {
      errors.push("name must be alphanumeric with hyphens, no leading/trailing/consecutive hyphens");
    }
    if (skill.path) {
      const dirName = path.basename(skill.path);
      if (dirName.toLowerCase() !== skill.name.toLowerCase()) {
        errors.push(`name "${skill.name}" must match directory "${dirName}"`);
      }
    }
  }

  if (!skill.description) {
    errors.push("description is required");
  } else if (skill.description.length > MAX_DESCRIPTION_LENGTH) {
    errors.push(`description exceeds ${MAX_DESCRIPTION_LENGTH} characters`);
  }

  if (skill.compatibility && skill.compatibility.length > MAX_COMPATIBILITY_LENGTH) {
    errors.push(`compatibility exceeds ${MAX_COMPATIBILITY_LENGTH} characters`);
  }

  return errors;
}

function splitFrontmatter(content: string): { frontmatter: string; body: string } | null {
  const normalized = content.replace(/\r\n/g, "\n");

  if (!normalized.startsWith("---\n")) {
    return null;
  }

  const rest = normalized.slice(4);
  const endIndex = rest.indexOf("\n---");

  if (endIndex === -1) {
    return null;
  }

  return {
    frontmatter: rest.slice(0, endIndex),
    body: rest.slice(endIndex + 4).trim(),
  };
}

export function parseSkillContent(content: string, filePath: string): Skill | null {
  const split = splitFrontmatter(content);
  if (!split) return null;

  let frontmatter: SkillFrontmatter;
  try {
    frontmatter = parseYaml(split.frontmatter) as SkillFrontmatter;
  } catch {
    return null;
  }

  if (!frontmatter || typeof frontmatter !== "object") return null;
  if (!frontmatter.name || !frontmatter.description) return null;

  return {
    name: frontmatter.name,
    description: frontmatter.description,
    license: frontmatter.license,
    compatibility: frontmatter.compatibility,
    metadata: frontmatter.metadata,
    instructions: split.body,
    path: path.dirname(filePath),
    skillFilePath: filePath,
  };
}

async function walkDirectory(
  transport: Transport,
  signal: AbortSignal,
  dirPath: string,
  callback: (filePath: string) => Promise<void>
): Promise<void> {
  let entries: Array<{ entry: string; isDirectory: boolean }>;
  try {
    entries = await transport.readdir(signal, dirPath);
  } catch {
    return;
  }

  for (const entry of entries) {
    if (signal.aborted) return;

    const fullPath = path.join(dirPath, entry.entry);

    if (entry.isDirectory) {
      await walkDirectory(transport, signal, fullPath, callback);
    } else if (entry.entry === SKILL_FILE_NAME) {
      await callback(fullPath);
    }
  }
}

export async function discoverSkills(
  transport: Transport,
  signal: AbortSignal,
  skillsPaths: string[]
): Promise<Skill[]> {
  const skills: Skill[] = [];
  const seen = new Set<string>();
  const seenNames = new Set<string>();

  for (const basePath of skillsPaths) {
    if (signal.aborted) break;

    const exists = await transport.pathExists(signal, basePath);
    if (!exists) continue;

    await walkDirectory(transport, signal, basePath, async (filePath) => {
      if (signal.aborted) return;
      if (seen.has(filePath)) return;
      seen.add(filePath);

      try {
        const content = await transport.readFile(signal, filePath);
        const skill = parseSkillContent(content, filePath);

        if (!skill) {
          console.warn(`Failed to parse skill file: ${filePath}`);
          return;
        }

        const errors = validateSkill(skill);
        if (errors.length > 0) {
          console.warn(`Skill validation failed for ${filePath}: ${errors.join(", ")}`);
          return;
        }

        if (seenNames.has(skill.name)) {
          console.warn(`Duplicate skill name "${skill.name}" at ${filePath}, skipping`);
          return;
        }
        seenNames.add(skill.name);

        skills.push(skill);
      } catch (e) {
        console.warn(`Error reading skill file ${filePath}: ${e}`);
      }
    });
  }

  return skills;
}

function escapeXml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

export function toPromptXML(skills: Skill[]): string {
  if (skills.length === 0) return "";

  const lines: string[] = ["<available_skills>"];

  for (const skill of skills) {
    lines.push("  <skill>");
    lines.push(`    <name>${escapeXml(skill.name)}</name>`);
    lines.push(`    <description>${escapeXml(skill.description)}</description>`);
    lines.push(`    <location>${escapeXml(skill.skillFilePath)}</location>`);
    lines.push("  </skill>");
  }

  lines.push("</available_skills>");
  return lines.join("\n");
}

export async function getDefaultSkillsPath(
  transport: Transport,
  signal: AbortSignal
): Promise<string> {
  const home = await getEnvVar(signal, transport, "HOME", 5000);
  return path.join(home, ".config/agents/skills");
}
