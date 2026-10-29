# Roadmap

What might come after 1.0. Nothing here is promised; issues and pull requests that move one of
these along are welcome.

- **Watch your subagents.** The engine already names each subagent's transcript; the pane could
  follow one, or draw several workers in one office.
- **Other CLIs as workers.** The pane itself needs Claude Code, but what it follows is a log. Gemini
  CLI's `--output-format stream-json` and Codex's `exec --json` are close enough to read with a
  reader adapter each, given real sample logs to test against.
- **Side by side.** Two sources in one pane (a worker and a baseline), the same scene twice.
- **A band above the prompt.** One row with the worker's activity and a sparkline, for when the
  pane is closed or the terminal too narrow to seat it.
- **Replay as a screensaver.** The last finished run, playing in ambient while nothing is followed.
- **The worker script on every server.** `scripts/lookout-worker` is tested end to end with LM
  Studio; runs on vLLM and mlx-serve, and reports from other servers that speak the Anthropic
  Messages API, would widen it.
- **More scenes.** [CONTRIBUTING.md](CONTRIBUTING.md) is the scene guide; a scene is one pure
  `draw(ctx)` function and a demo loop to look right across.
