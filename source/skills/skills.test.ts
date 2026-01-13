import { describe, it, expect } from "vitest";
import { parseSkillContent, validateSkill, toPromptXML, Skill } from "./skills.ts";

describe("skills", () => {
  describe("parseSkillContent", () => {
    it("parses a full skill file", () => {
      const content = `---
name: pdf-processing
description: Extracts text and tables from PDF files.
license: MIT
compatibility: Requires python 3.8+
metadata:
  author: test-org
  version: "1.0"
---

# PDF Processing

Use this skill when working with PDFs.
`;

      const skill = parseSkillContent(content, "/skills/pdf-processing/SKILL.md");

      expect(skill).not.toBeNull();
      expect(skill!.name).toBe("pdf-processing");
      expect(skill!.description).toBe("Extracts text and tables from PDF files.");
      expect(skill!.license).toBe("MIT");
      expect(skill!.compatibility).toBe("Requires python 3.8+");
      expect(skill!.metadata).toEqual({ author: "test-org", version: "1.0" });
      expect(skill!.instructions).toBe(
        "# PDF Processing\n\nUse this skill when working with PDFs.",
      );
      expect(skill!.path).toBe("/skills/pdf-processing");
      expect(skill!.skillFilePath).toBe("/skills/pdf-processing/SKILL.md");
    });

    it("parses a minimal skill file", () => {
      const content = `---
name: my-skill
description: A simple skill.
---

Instructions here.
`;

      const skill = parseSkillContent(content, "/skills/my-skill/SKILL.md");

      expect(skill).not.toBeNull();
      expect(skill!.name).toBe("my-skill");
      expect(skill!.description).toBe("A simple skill.");
      expect(skill!.instructions).toBe("Instructions here.");
    });

    it("returns null for missing frontmatter", () => {
      const content = "# Just Markdown\n\nNo frontmatter here.";
      const skill = parseSkillContent(content, "/test/SKILL.md");
      expect(skill).toBeNull();
    });

    it("returns null for unclosed frontmatter", () => {
      const content = `---
name: broken
description: Missing closing delimiter
`;
      const skill = parseSkillContent(content, "/test/SKILL.md");
      expect(skill).toBeNull();
    });

    it("returns null for missing required fields", () => {
      const content = `---
name: no-description
---

Content here.
`;
      const skill = parseSkillContent(content, "/test/SKILL.md");
      expect(skill).toBeNull();
    });

    it("handles CRLF line endings", () => {
      const content =
        "---\r\nname: crlf-skill\r\ndescription: Works with Windows line endings.\r\n---\r\n\r\nInstructions.";
      const skill = parseSkillContent(content, "/test/SKILL.md");

      expect(skill).not.toBeNull();
      expect(skill!.name).toBe("crlf-skill");
    });
  });

  describe("validateSkill", () => {
    it("validates a correct skill", () => {
      const skill: Skill = {
        name: "valid-skill",
        description: "A valid skill description.",
        instructions: "Do things.",
        path: "/skills/valid-skill",
        skillFilePath: "/skills/valid-skill/SKILL.md",
      };

      const errors = validateSkill(skill);
      expect(errors).toHaveLength(0);
    });

    it("requires name", () => {
      const skill: Skill = {
        name: "",
        description: "Has description.",
        instructions: "",
        path: "",
        skillFilePath: "",
      };

      const errors = validateSkill(skill);
      expect(errors).toContain("name is required");
    });

    it("requires description", () => {
      const skill: Skill = {
        name: "no-desc",
        description: "",
        instructions: "",
        path: "/skills/no-desc",
        skillFilePath: "",
      };

      const errors = validateSkill(skill);
      expect(errors).toContain("description is required");
    });

    it("validates name format", () => {
      const skill: Skill = {
        name: "-invalid-name",
        description: "Description.",
        instructions: "",
        path: "",
        skillFilePath: "",
      };

      const errors = validateSkill(skill);
      expect(errors.some(e => e.includes("alphanumeric"))).toBe(true);
    });

    it("validates name matches directory", () => {
      const skill: Skill = {
        name: "skill-one",
        description: "Description.",
        instructions: "",
        path: "/skills/skill-two",
        skillFilePath: "",
      };

      const errors = validateSkill(skill);
      expect(errors.some(e => e.includes("must match directory"))).toBe(true);
    });

    it("validates name length", () => {
      const skill: Skill = {
        name: "a".repeat(65),
        description: "Description.",
        instructions: "",
        path: "",
        skillFilePath: "",
      };

      const errors = validateSkill(skill);
      expect(errors.some(e => e.includes("exceeds 64"))).toBe(true);
    });

    it("validates description length", () => {
      const skill: Skill = {
        name: "test",
        description: "a".repeat(1025),
        instructions: "",
        path: "/skills/test",
        skillFilePath: "",
      };

      const errors = validateSkill(skill);
      expect(errors.some(e => e.includes("description exceeds"))).toBe(true);
    });

    it("validates compatibility length", () => {
      const skill: Skill = {
        name: "test",
        description: "Description.",
        compatibility: "a".repeat(501),
        instructions: "",
        path: "/skills/test",
        skillFilePath: "",
      };

      const errors = validateSkill(skill);
      expect(errors.some(e => e.includes("compatibility exceeds"))).toBe(true);
    });

    it("allows mixed case names", () => {
      const skill: Skill = {
        name: "MySkill",
        description: "Description.",
        instructions: "",
        path: "/skills/MySkill",
        skillFilePath: "",
      };

      const errors = validateSkill(skill);
      expect(errors).toHaveLength(0);
    });
  });

  describe("toPromptXML", () => {
    it("generates XML for skills", () => {
      const skills: Skill[] = [
        {
          name: "pdf-processing",
          description: "Extracts text from PDFs.",
          instructions: "",
          path: "/skills/pdf-processing",
          skillFilePath: "/skills/pdf-processing/SKILL.md",
        },
        {
          name: "data-analysis",
          description: "Analyzes datasets & charts.",
          instructions: "",
          path: "/skills/data-analysis",
          skillFilePath: "/skills/data-analysis/SKILL.md",
        },
      ];

      const xml = toPromptXML(skills);

      expect(xml).toContain("<available_skills>");
      expect(xml).toContain("</available_skills>");
      expect(xml).toContain("<name>pdf-processing</name>");
      expect(xml).toContain("<description>Extracts text from PDFs.</description>");
      expect(xml).toContain("<location>/skills/pdf-processing/SKILL.md</location>");
      expect(xml).toContain("&amp;"); // XML escaping for &
    });

    it("returns empty string for empty skills array", () => {
      expect(toPromptXML([])).toBe("");
    });

    it("escapes XML special characters", () => {
      const skills: Skill[] = [
        {
          name: "test-skill",
          description: 'Uses <tags> & "quotes"',
          instructions: "",
          path: "/skills/test-skill",
          skillFilePath: "/skills/test-skill/SKILL.md",
        },
      ];

      const xml = toPromptXML(skills);

      expect(xml).toContain("&lt;tags&gt;");
      expect(xml).toContain("&amp;");
      expect(xml).toContain("&quot;quotes&quot;");
    });
  });
});
