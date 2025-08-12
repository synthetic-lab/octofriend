TODO:

- [ ] Situational awareness: if it's a git repo, check the gitignore, and get a
  bunch of the directory heirarchy into context space automatically.
- [ ] Gemini API support: their "openai-compatible" API isn't complete enough
  to work with Octo
- [ ] Refactor History/IR for type safety: link back between i.e. tool calls,
  tool outputs, and original assistant messages
- [ ] Refactor menu system to use the new Router/Back stuff built for the add
  model flow.
- [ ] Allow Anthropic models to configure the thinking budget by tokens, rather
  than low/medium/high corresponding to specific budgets (2048/4096/8192)
- [ ] Auto-detect missing API keys for diff-apply and fix-json at boot if they're
  configured to be on, similar to detecting default model issues
- [ ] Prompt on app start for an API key if no API key is set up for the
  default model. Ditto for autofix models if they're turned on
- [ ] Prompt for api key for the cli prompt subcommand
- [ ] Make the CLI prompt subcommand work with the anthropic and responses APIs
- [ ] Add clickable URLs for known inference hosts to get an API key — use
  wandb-style authorize URLs if they exist!
- [ ] Generate desktop notifs with configurable debounce when waiting for user
  input via https://github.com/Aetherinox/node-toasted-notifier
- [ ] Consider not keeping the current files up-to-date and instead only
  updating them on read tool call. Could be confusing to see a bunch of stuff
  change in the history without telling the LLM what's going on
