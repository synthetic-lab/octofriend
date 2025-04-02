![octofriend](./octofriend.png)

```bash
$ npm install --global octofriend
```

TODO:

- [ ] Allow configuring a "guru mode" to call to a reasoning LLM. The LLM can
  enter guru mode by calling a `enter_mode` tool, and when in guru mode, the LLM
  can exit by calling an `exit_mode` tool. When entering guru mode, the
  LLM has to state the problem it wants to solve in guru mode; the guru mode
  version should be instructed to auto-exit once it's done. Maybe there are
  configurable modes in general? E.g. an explore mode vs a write code mode vs
  an architect mode. Let the config file handle all of that.
- [ ] Context optimization for repeated reads of the same file: only include
  the latest version of the file, much like the edit optimization
- [ ] Situational awareness: automatically get 1-2 layers of dir hierarchy into
  the context window automatically. Ignore files in the .gitignore
- [ ] A `plan` tool that just keeps stuff in the situational awareness context
- [ ] Make file writing (edits, file creation) different than just calling
  tools, so that you don't need to put everything inside JSON (which makes the
  LLMs worse at writing code). Have a couple extra tags:
  * `<run-edit filepath="..." type="...">`: wraps all file edit/create ops. The
    `</run-edit>` closing tag is another stop token. Types can be:
    * `diff`
    * `append`
    * `prepend`
    * `create`
  * `<diff-search>`: inner element that wraps search queries for type=diff
  * `<diff-replace>`: inner element that wraps replace strings for type=diff
  Use an actual streaming XML parser to parse out this stuff.