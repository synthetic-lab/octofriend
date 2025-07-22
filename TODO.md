TODO:

- [ ] Situational awareness: if it's a git repo, check the gitignore, and get a
  bunch of the directory heirarchy into context space automatically.
- [ ] `mkdir -p` for file creation, don't fail if the dir doesn't exist
- [ ] Support the Anthropic API
- [ ] Gemini support
- [ ] Accurately count tokens used during model setup
- [ ] Count tokens per-model
- [ ] Differentiate between input and output tokens in token counting
- [ ] Refactor History/IR for type safety: link back between i.e. tool calls,
  tool outputs, and original assistant messages
- [ ] Refactor menu system to use a stack of screens that can consistently be
  popped, rather than ad-hoc state linking. The stack entries are typed and
  each different state/internal-URI can have typed data associated with it.
- [ ] Link out directly to inference websites for API keys

# Launch blocking

nothing?
