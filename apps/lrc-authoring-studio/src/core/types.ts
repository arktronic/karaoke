/** One independently timed unit: a word or a syllable. */
export interface Token {
  text: string;
  /** Whether whitespace follows this token in the lyrics. */
  spaceAfter: boolean;
  startMs?: number;
  /** Optional; only meaningful on the last token of a word. Unset means "until the next start". */
  endMs?: number;
}

export interface Line {
  tokens: Token[];
}

export interface Project {
  lines: Line[];
}

export interface TokenRef {
  line: number;
  token: number;
}

/** The next token to receive a start time. */
export type Cursor = TokenRef;

export type SlotKind = 'start' | 'end';

export interface SlotRef extends TokenRef {
  kind: SlotKind;
}
