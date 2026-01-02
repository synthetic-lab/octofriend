import { t } from "structural";
import { defineTool, ToolDef } from "../common.ts";
import { discoverSkills, getDefaultSkillsPath, Skill } from "../../skills/skills.ts";
import type { Config } from "../../config.ts";
import type { Transport } from "../../transports/transport-common.ts";

async function loadSkills(transport: Transport, signal: AbortSignal, config: Config): Promise<Skill[]> {
  const skillsPaths: string[] = [];

  if (config.skills?.paths && config.skills.paths.length > 0) {
    skillsPaths.push(...config.skills.paths);
  } else {
    const defaultPath = await getDefaultSkillsPath(transport, signal);
    skillsPaths.push(defaultPath);
  }

  return await discoverSkills(transport, signal, skillsPaths);
}

const ArgumentsSchema = t.subtype({
  skillName: t.str.comment("Name of the skill to load"),
});

export default defineTool(async function(transport: Transport, signal: AbortSignal, config: Config) {
  const skills = await loadSkills(transport, signal, config);

  const skillDescriptions = skills.map(s => `${s.name}: ${s.description}`).join("; ");

  const Schema = t.subtype({
    name: t.value("skills"),
    arguments: ArgumentsSchema,
  }).comment(
    skills.length === 0
      ? "Loads and displays the instructions for a skill"
      : `Loads and displays the instructions for a skill. Available skills: ${skillDescriptions}`
  );

  return {
    Schema,
    ArgumentsSchema,
    async validate() {
      return null;
    },
    async run(_1, _2, call) {
      const { skillName } = call.arguments;
      const skill = skills.find(s => s.name.toLowerCase() === skillName.toLowerCase());

      if (!skill) {
        return {
          content: `Skill "${skillName}" not found. Available skills: ${skills.map(s => s.name).join(", ")}`,
        };
      }

      return {
        content: `Skill: ${skill.name}\nDescription: ${skill.description}\n\n---\n\nInstructions:\n\n${skill.instructions}`,
      };
    },
  } satisfies ToolDef<t.GetType<typeof Schema>>;
});
