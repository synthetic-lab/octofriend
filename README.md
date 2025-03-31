![octofriend](./octofriend.png)

```bash
$ npm install --global octofriend
```

TODO:

- [ ] Handle LLMs sending incorrectly formatted tools (look in llm.ts)
- [ ] Automatically force LLMs to re-read files if they've been edited more
  recently than the last read
- [ ] Disallow edits unless the file was read first
- [ ] Allow configuring a "guru mode" to call to a reasoning LLM. The LLM can
  enter guru mode by calling a `guru_mode` tool, and when in guru mode, the LLM
  can exit by calling an `exit_guru_mode` tool. When entering guru mode, the
  LLM has to state the problem it wants to solve in guru mode; the guru mode
  version should be instructed to auto-exit once it's done.
- [ ] Handle `<think>` tags as well as reasoning tokens in the UI
