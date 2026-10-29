import { readFileSync } from 'node:fs';
import { z } from 'zod';
import type { Turn } from './chain.js';
import { ConfigError, PromptBuildError } from './errors.js';
import type { Intent } from './types.js';

/** Shape of <domain>/prompts/answer.json (owner-authored data; extra fields are allowed). */
export const AnswerPromptSchema = z.object({
  role: z.string(),
  task: z.string(),
  constraints: z.object({
    language: z.string(),
    tone: z.string(),
    max_words: z.number(),
  }),
  instructions: z.array(z.string()),
  citation_rules: z.array(z.string()),
  format_example: z.string(),
  intent_instructions: z.object({
    lookup: z.string(),
    explain: z.string(),
    compare: z.string(),
    timeline: z.string(),
  }),
  history_empty_text: z.string(),
  source_format: z.string(),
  refusal: z.object({ insufficient_context: z.string() }),
});
export type AnswerPromptData = z.infer<typeof AnswerPromptSchema>;

export interface PromptSource {
  n: number;
  title: string;
  section: string;
  locator: string;
  text: string;
}

export interface PromptInput {
  promptData: AnswerPromptData;
  template: string;
  intent: Intent;
  history: Turn[];
  sources: PromptSource[];
  question: string;
}

export function loadPromptFiles(answerFile: string, templateFile: string) {
  const parsed = AnswerPromptSchema.safeParse(JSON.parse(readFileSync(answerFile, 'utf8')));
  if (!parsed.success)
    throw new ConfigError(`Invalid ${answerFile}:\n${z.prettifyError(parsed.error)}`);
  return { promptData: parsed.data, template: readFileSync(templateFile, 'utf8') };
}

const PLACEHOLDER = /\{([a-z_]+)\}/g;

/**
 * Replaces every {placeholder} in ONE pass. Inserted values are never re-scanned, so braces or
 * instructions inside sources, history or the question stay inert text. A placeholder without a
 * value throws PromptBuildError.
 */
export function fill(template: string, values: Record<string, string>): string {
  return template.replace(PLACEHOLDER, (_match, key: string) => {
    const value = values[key];
    if (value === undefined) throw new PromptBuildError(`No value for placeholder {${key}}`);
    return value;
  });
}

const numbered = (lines: string[]) => lines.map((l, i) => `${i + 1}. ${l}`).join('\n');

export const PromptBuilder = {
  build(input: PromptInput): string {
    const p = input.promptData;
    const history =
      input.history.length === 0
        ? p.history_empty_text
        : input.history.map((t) => `User: ${t.question}\nAssistant: ${t.answer}`).join('\n');
    const sources = input.sources
      .map((s) =>
        fill(p.source_format, {
          n: String(s.n),
          title: s.title,
          section: s.section,
          locator: s.locator,
          text: s.text,
        }),
      )
      .join('\n\n');
    return fill(input.template, {
      role: p.role,
      task: p.task,
      language: p.constraints.language,
      tone: p.constraints.tone,
      max_words: String(p.constraints.max_words),
      instructions: numbered(p.instructions),
      citation_rules: numbered(p.citation_rules),
      intent: input.intent,
      intent_instructions: p.intent_instructions[input.intent],
      refusal_message: p.refusal.insufficient_context,
      format_example: p.format_example,
      history,
      sources,
      question: input.question,
    });
  },
};
