import { t } from "structural";
import { unionAll } from "../../types.ts";
import { defineTool, ToolDef } from "../common.ts";
import { discoverSkills } from "../../skills/skills.ts";

export default defineTool(async function(signal, transport, config) {
  const skills = await discoverSkills(transport, signal, config);
  if(skills.length === 0) return null;

  const skillDescriptions = JSON.stringify(
    skills.map(s => ({ name: s.name, description: s.description }))
  );

  const skillNameSchemas = skills.map(s => t.value(s.name));
  const ArgumentsSchema = t.subtype({
    skillName: skillNameSchemas.length === 0 ? t.never : unionAll(skillNameSchemas)
  });

  const Schema = t.subtype({
    name: t.value("skill"),
    arguments: ArgumentsSchema,
  }).comment(
    `Loads and displays the instructions for a skill. Available skills: ${skillDescriptions}`
  );

  return {
    Schema,
    ArgumentsSchema,
    async validate() {
      return null;
    },
    async run(_1, _2, call) {
      const { skillName } = call.arguments;
      const skill = skills.find(s => s.name === skillName)!;

      return {
        content: `
Skill name: ${skill.name}
Skill directory: ${skill.path}
Description: ${skill.description}

${config.yourName} has set up a skill for you to use. Skills are:

1. A SKILL.md file containing instructions for you, in a directory.
2. Optional scripts or assets stored in subdirectories of the skill's directory.

If there are scripts or assets stored in directories or subdirectories, typically they will be
referenced in the SKILL.md instructions. If there are no instructions relating to scripts or assets,
it's likely that they don't exist for this skill.

Here are the contents of the SKILL.md file stored at ${skill.skillFilePath}:
---
${skill.instructions}
`.trim(),
      };
    },
  } satisfies ToolDef<t.GetType<typeof Schema>>;
});
