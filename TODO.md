TODO:

- [ ] Situational awareness: if it's a git repo, check the gitignore, and get a
  bunch of the directory heirarchy into context space automatically.
- [ ] `mkdir -p` for file creation, don't fail if the dir doesn't exist

# Launch blocking
- [ ] Prompt context space improvement: rather than sticking all the context
  space at the end:
  - [ ] Stick perma-tracked items in the system prompt, like OCTO.md
  - [ ] Convert the LLM messages first into an IR: just LLM messages, BUT,
    there's an extra tool-output type that's tool-aware. If it's an edit tool
    type, file creation tool type, or read tool type, it tracks the file path.
    Do a third pass to strip out all responses that are outdated, so the LLM
    doesn't see old files and get confused.
