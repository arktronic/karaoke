# lrc2ass Design

`lrc2ass` is a TypeScript library and Node.js CLI for converting LRC lyrics into readable, libass-compatible ASS karaoke subtitles.

## Scope

- Parse simple LRC, enhanced word-timed LRC, multiple timestamps per line, metadata, and explicitly supported common variants. Sanity check against other libraries, such as https://github.com/jacquesh/foo_openlyrics.
- Generate line-timed and word-highlighted ASS.
- Support configurable timing, styles, layout, gaps/interludes, and a multi-line preset.
- Expose editable LRC and ASS models, staged APIs, and a one-step conversion API.
- Keep plugins, complex effects, and graphical tools out of the initial release.

## Architecture

```text
LRC text -> parse -> LRC document -> normalize timing -> plan events
         -> ASS document -> serialize -> ASS text
```

- **Parser:** recognizes supported LRC and returns a document plus diagnostics.
- **Normalizer:** applies offsets, expands repeated timestamps, orders occurrences, and infers boundaries.
- **Event planner:** applies karaoke, layout, style, preset, and interlude options.
- **Serializer:** produces canonical ASS text.
- **CLI:** handles Node.js files, streams, messages, and exit codes; it contains no conversion rules.

The public API provides parse, convert, and serialize stages plus a one-step function composed from those stages.

## Core Decisions

- The core has no runtime dependencies or Node.js APIs. It supports ESM, browsers, and other modern JavaScript runtimes.
- LRC and ASS models are public and editable. The LRC model preserves source order, locations, multiple timestamps, and recoverable unknown entries, but need not reproduce the original bytes.
- Parsing requires an explicit `strict` or `tolerant` mode. Recoverable source problems use stable structured diagnostics; exceptions are reserved for API misuse and broken invariants.
- Diagnostic fields are public, but diagnostic code strings remain internal until the public API is stabilized.
- Times use integer milliseconds until conversion to ASS centiseconds.
- Presets are immutable option sets, not separate conversion paths. Explicit caller options override preset values.
- Serialization is deterministic: the same document always serializes to the same text. Presets, defaults, and exact output are expected to evolve and are not a compatibility guarantee — only public model/option/result _shapes_ (field names and types) are.
- libass is the rendering baseline; renderer-specific extensions are initially out of scope.

## Conversion Rules

- Apply metadata and caller offsets before normalization.
- Expand every line timestamp into an occurrence. Equal starts remain distinct and retain source order.
- For enhanced repeated lines, apply each inline timestamp's offset from the first line timestamp to every occurrence.
- Infer a line end from the next later occurrence. For the final line, use LRC `length` metadata, `t_time` metadata, a caller-provided track end/duration, or the exported 5000 ms fallback, in that order. A bound that is not later than the final lyric is diagnosed and falls back in tolerant mode.
- Infer an enhanced segment's end from the next inline timestamp or the containing line end.
- Handle source overlaps through an explicit `preserve`, `truncate`, or `error` policy.
- Negative or decreasing effective times fail in strict mode; tolerant mode clamps them and emits diagnostics.
- Completely untimed lines remain in the model but cannot produce events without caller-supplied timing.
- Plain lines produce one dialogue event; enhanced segments use a selected standard ASS karaoke effect. A leading enhanced-timestamp gap is encoded as an empty karaoke syllable so timed text begins at its supplied offset, unless a pre-sweep dot count-in is shown instead (see Event Planner Defaults). The converter does not invent word timing or perform linguistic tokenization.
- A lyric's effective sung-start is its first enhanced (non-whitespace) segment's absolute time (or its own timestamp if plain/segment-less).
- Interlude options define the minimum gap, margins, strategy (text, countdown, or progress-bar), style, and placement. `progressBarY` sets the progress bar's top edge in ASS canvas pixels (default 161); `progressBarHeightPx` sets its height (default 24). `trailingLyricDurationMs` limits an enhanced lyric after its final timed segment (or a plain lyric after its start), creating a gap before the next lyric without truncating earlier enhanced timing.
- Escape lyric text so embedded ASS override syntax cannot execute.
- The parser validates timestamp component ranges and integer precision, rejecting out-of-range values.
- Public LRC and ASS models are directly editable. Callers who edit them are responsible for preserving their invariants.

## ASS Output

- Generate ASS `v4.00+` with `[Script Info]`, `[V4+ Styles]`, and `[Events]`.
- Include explicit play resolution and at least one lyric style.
- Quantize boundaries to centiseconds once. Derive karaoke durations from adjacent quantized boundaries; events that collapse to zero duration are omitted.
- Use stable ordering, naming, escaping, numeric formatting, and line endings. Planner events are ordered by start time, layer, then source insertion order.

### Event Planner Defaults

- The planner emits deterministic `Lyrics`, `Preview`, and `Interlude` styles from `PlanStyleOptions`.
- `multi-line` (default preset) shows the current lyric plus upcoming lines as `Preview` events, each on a permanently-assigned row, so a line's on-screen position never changes when it becomes active. `single-line` shows only the active lyric.
- Rows share one alignment (`layout.rowAlignment`, restricted to top/bottom anchors since ASS ignores `MarginV` for middle alignments) with a per-event `MarginV` override rather than alternating alignments — this scales cleanly to any row count.
- `maxPreviewLines`, `previewLeadMs`, `lingerMaxMs`, and the interlude `minGapMs`/`blankGapMs` thresholds are configurable; see `PlanOptions` for exact semantics and defaults.
- Interludes support `text`, `countdown`, and `progress-bar` strategies for filling long gaps.
- `fadeInMs`/`fadeOutMs` fade every event in/out, except at a same-row `Preview`-to-`Lyrics` handoff, so an already-visible line doesn't flicker when it becomes current.
- A pre-sweep dot count-in gives the singer a visible, timed cue for when to start, in place of an inert empty gap.
- Planner options are validated at runtime; invalid values throw `RangeError`.

## Configuration Areas

- Timing, final duration, and overlap behavior.
- Karaoke effect.
- Resolution, alignment, margins, layers, and current/next preview timing.
- Font and ASS style values.
- Interlude behavior.
- Metadata emission and serialization formatting.

Options remain typed, declarative, and serializable. Advanced callers can edit the ASS model directly.

For `convert()`, normalization inherits `parse.mode` unless `normalize.mode` explicitly overrides it. Both default to tolerant mode.

## Verification

Tests should cover parsing and recovery, timing inference, event planning, deterministic serialization, staged/one-step equivalence, ESM loading, and browser use. Visual rendering verification against libass/ffmpeg is out of scope: output correctness is established through deterministic, structural assertions on serialized ASS text instead.
