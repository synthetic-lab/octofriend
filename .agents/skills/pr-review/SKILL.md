---
name: "pr-review"
description: "Review Github pull requests"
---
To load a Github pull request, run the fetch tool twice:


## First fetch
First, load the URL for the PR to understand the author's intent.

Your fetch tool does not execute JavaScript. Note that parts of the Github UI
may fail without JS; for example, loading comments might say:

```
UH OH!
There was an error while loading"
```

This is okay and expected. Don't worry about that.

## Second fetch: load the diff
To load the diff for the PR, fetch the PR URL with a `.diff`
attached to the end. For example, to review
`https://github.com/synthetic-lab/octofriend/pull/66`, you should fetch:

`https://github.com/synthetic-lab/octofriend/pull/66.diff`

The diff is the most important part. The author may be incorrect, or have the
right idea but the wrong implementation. Focus on whether there are any bugs or
unexpected behavior.
