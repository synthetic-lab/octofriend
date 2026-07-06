pub const fn compaction_prompt() -> &'static str {
    "Generate a summary of everything you've talked about and done in this conversation.\n\
\n\
You are creating an internal context summary that will replace previous messages in the conversation history.\n\
\n\
**IMPORTANT**: You are NOT continuing the conversation or responding to the user. You are creating a factual record of what has already happened. The user will likely never see this summary - it exists only to preserve context when the conversation resumes.\n\
\n\
**Your task**: Analyze the conversation history that you read at the beginning of this message and create a detailed technical summary capturing all essential information for continuing work.\n\
\n\
Before writing your summary, use <analysis> tags to organize your thinking:\n\
\n\
<analysis>\n\
[Chronologically review each part of the conversation and identify:\n\
- The user's explicit requests and goals\n\
- Actions that were taken and their outcomes\n\
- Technical decisions and their rationale\n\
- Important code changes, file modifications, and command outputs\n\
- Problems encountered and their resolutions\n\
- Work that remains incomplete]\n\
</analysis>\n\
\n\
Then provide your summary in this structure:\n\
\n\
<summary>\n\
## Primary Request\n\
[What the user asked for, in their own words if possible]\n\
\n\
## Work Completed\n\
[Specific actions taken, files modified, commands run - with results]\n\
\n\
## Technical Context\n\
- Architecture decisions made and why\n\
- Patterns, frameworks, libraries being used (with examples)\n\
- Commands that worked (exact syntax + relevant output)\n\
- Commands that failed (what was tried, error messages, why it failed)\n\
- Environment details (versions, dependencies, system info)\n\
\n\
## Files Modified\n\
For each file:\n\
- **[Filename]**: [Why it's relevant] [What changed] [Current state]\n\
\n\
## Work In Progress\n\
[Specific description of incomplete work - which files, what state they're in, what was being attempted]\n\
\n\
## Outstanding Issues\n\
- Errors not yet resolved (include error messages)\n\
- User requests acknowledged but not completed\n\
- Known blockers or risks\n\
\n\
## Context for Resuming\n\
[The most important things to know to pick up where this left off - reference specific files, line numbers, or error states]\n\
</summary>\n\
\n\
**Formatting rules**:\n\
- Write in past tense (\"The user requested...\", \"The assistant modified...\", \"The build failed...\")\n\
- Be specific: include file paths, function names, exact error messages, command syntax\n\
- Capture enough detail that work could resume without re-reading the full history\n\
- This is technical documentation, not a conversation\n"
}
