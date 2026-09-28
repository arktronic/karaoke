# Codebase-specific guidelines

- General guidelines always apply; follow these codebase-specific guidelines in addition to them.
- When combining defaults, presets, and caller options, preserve raw caller overrides until preset resolution so explicit caller values always win.
- When inheriting options across stages, treat undefined override values as unset so they do not wipe inherited defaults.
- For options-merge audits, always check both risks: (1) caller-intent loss from premature merging and (2) undefined overwriting inherited/default values.
- Do not use npx or npm; always prefer existing npm scripts via `pnpm`.
- Use `pnpm validate` as appropriate, instead of a series of separate test/lint/prettier runs.
