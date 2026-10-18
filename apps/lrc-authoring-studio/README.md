# LRC Authoring Studio

Static web app (no backend) for creating word-timed enhanced LRC files in the browser.

## Workflow

1. Drop a browser-playable audio file onto the page.
2. Paste lyrics, or search [LRCLIB](https://lrclib.net) (the only network request, made on demand from the browser).
3. Press Play, then press Space as each word starts. Optionally press F or J when the word just sung ends (use it before a pause); a word without an end lasts until the next word starts.
4. Refine times by dragging waveform markers, typing a value, or nudging the selected time.
5. Download or copy the LRC.

Use `/` in lyrics to split a word into separately timed syllables (`Hel/lo`); `\/` is a literal slash. Word ends can be set only after a whole word, not after a syllable.

## Keys

| Key               | Action                                          |
| ----------------- | ----------------------------------------------- |
| Space             | Start the next word (only while playing)        |
| F or J            | End the word just started (only while playing)  |
| Z or Backspace    | Undo the last Space / F / J press and seek back |
| Enter             | Play / pause                                    |
| Home              | Seek to the start of the track                  |
| Left / Right      | Nudge the selected time by 10 ms (Shift 100)    |
| Double-click chip | Continue tapping from that word                 |

Undo covers key presses only; any manual edit (drag, nudge, typed value, clear, lyrics change) resets the undo history. A word end can also be added afterwards with "Set end at playhead" or by typing its time. Clearing a word's start also clears its end.

## Output

```text
[00:10.00]<00:10.00>Hel<00:10.30>lo<00:10.50> <00:12.00>world
```

Times are rounded to centiseconds. A word end is written right after the word; the pause until the next word is the space segment between the tags. Lines with any untimed word are omitted from the output. Nothing is persisted, so export before closing the tab.

## Development

```sh
pnpm --filter lrc-authoring-studio dev
pnpm --filter lrc-authoring-studio build
```

The build uses a relative base path, so `dist` can be hosted from any static path (for example GitHub Pages).

Pure logic (tokenizing, timing sequence, LRC serialization, peaks, LRCLIB client) lives in `src/core` and is unit-tested; `src/audio` and `src/ui` are thin browser wrappers.
