# Changelog

## 1.0.0 (2026-10-28)

The first public release. lookout is a sidebar for Claude Code: you work with Claude in the main
area, and the pane beside it shows what is going on, in that session or in a headless worker you
handed a task to.

- **This session, with nothing to set up.** With no worker log in the project, the pane follows the
  session it sits in, from its own transcript: Claude at its desk, "your turn" between turns.
- **A worker in one command.** `scripts/lookout-worker "the task"` finds a llama.cpp, Ollama, LM
  Studio, vLLM or mlx-serve server on its usual port, picks the loaded model, writes the hand-off
  and runs `claude -p` against the server's Anthropic Messages API into
  `logs/worker-current.jsonl`, which the pane follows. `/lookout worker` prints the command for an
  installed mod. Tested end to end with LM Studio; Ollama and llama.cpp answer at the endpoint.
  The rack finds the server on its usual port and shows decode speed and memory. Any other
  `claude -p --output-format stream-json --verbose` log can be followed by path or by name.
- **Three scenes**: office (the default, sized for a sidebar), office-hd (the same room at four
  times the density, whose monitor shows the actual diff and output) and observatory (a quiet sky).
  The rooms remember the run: a mug per ten turns, a paper stack for the edits, crumpled errors in
  the bin, a tally of test runs with a gold star after a red → green flip, parcels for commits,
  and a printed slip at the end.
- **Ambience**: a slow lofi layer in every scene (rain on the window, a city across the street,
  string lights, steam off the mug, the cat breathing) that never draws over text or in a colour
  that reports the run. On by default; `ambience: off` turns it off.
- **Three layouts**: calm (the default) tells the run in plain words: what is happening now, the
  task, the latest thinking, a few facts so far and what is worth a look. detailed adds a grid of
  instrument modules and every text block, with `d` to unfold the last diff and command output;
  from 70 columns the modules flank a large scene. ambient is the scene alone, and on a tall pane
  office-hd becomes the showcase, its wall filled with the thinking, instruments and a board of
  tool calls.
- **Readable thinking.** The thinking's gist, worked out locally, with problems, good news, doubts
  and names coloured; and, if you turn on `explain`, one to three plain sentences from a small
  model. Off by default.
- **One home per fact.** Each reading is spelled out once; the scene drops its own text for what a
  module already shows and keeps the picture.
- **Nothing to install but the mod.** The log reader is TypeScript inside the mod and reads only
  what a log has appended since the last poll.
- Three palettes (night, paper, phosphor), seasons in the office window, notifications,
  achievements, replay, a runs scoreboard, an API cost estimate, and the read-only
  `mcp__lookout__status` tool for the session you talk to.
- **Private by default.** lookout reads files and talks to your local model server; nothing leaves
  your machine unless you turn on `explain`.

Retired names still read: the scenes `controlroom` and `aurora` draw office-hd and observatory,
and the layouts `classic`, `panel` and `wall` draw detailed.
