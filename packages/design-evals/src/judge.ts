/**
 * The judge: a vision model, looking at the rendered document.
 *
 * Rendered, not authored. Every question above level 3 is about what a reader
 * sees, and the JSON is not that — a document can be schema-clean, rule-clean
 * and still land as a wall of grey. So the judge is handed the same contact
 * sheet a person would look at, and never the source.
 *
 * Its verdict is `evaluative` and never a gate. It scores the scorecard's
 * headline metric ("would you send this unchanged?"), which is a judgement
 * call by construction; the hard metrics beside it are the part that does not
 * depend on anyone's taste, including the judge's.
 *
 * The model is injected. Tests drive a scripted judge, and a live run reports
 * what it cost, because a corpus judged forty times over is a real bill.
 */

import type { Brief } from './corpus.js';
import {
  PAIRWISE_SCHEMA,
  rubricPrompt,
  VERDICT_SCHEMA,
  type JudgeVerdict,
  type PairwiseVerdict,
} from './rubric.js';

export interface JudgeImage {
  /** PNG bytes of a contact sheet, or of a single page. */
  png: Buffer;
  label: string;
}

export interface VisionCall {
  (input: {
    system: string;
    text: string;
    images: readonly JudgeImage[];
    schema: unknown;
  }): Promise<{ value: unknown; inputTokens: number; outputTokens: number }>;
}

export interface JudgeResult<T> {
  verdict: T;
  inputTokens: number;
  outputTokens: number;
}

export class JudgeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'JudgeError';
  }
}

function asVerdict(value: unknown): JudgeVerdict {
  const record = value as Partial<JudgeVerdict> | null;
  if (
    !record ||
    typeof record.level !== 'number' ||
    record.level < 1 ||
    record.level > 5 ||
    typeof record.wouldShip !== 'boolean' ||
    typeof record.genericness !== 'number' ||
    typeof record.rationale !== 'string'
  ) {
    throw new JudgeError(
      `The judge answered something that is not a verdict: ${JSON.stringify(value).slice(0, 200)}`
    );
  }
  return record as JudgeVerdict;
}

/**
 * What the document was asked for, so the judge scores the answer and not the
 * question.
 *
 * A deck that is beautiful and answers a different brief is not a good deck,
 * and level 4 — does the structure fit the purpose — cannot be assessed
 * without knowing the purpose.
 */
function briefContext(brief: Brief): string {
  return [
    `The brief was for a .${brief.format} document: ${brief.title}`,
    '',
    brief.text,
  ].join('\n');
}

export async function judgeDocument(input: {
  brief: Brief;
  sheet: JudgeImage;
  call: VisionCall;
}): Promise<JudgeResult<JudgeVerdict>> {
  const answered = await input.call({
    system: rubricPrompt(),
    text: [
      briefContext(input.brief),
      '',
      'The image is a contact sheet: every page of the produced document, tiled and numbered.',
    ].join('\n'),
    images: [input.sheet],
    schema: VERDICT_SCHEMA,
  });
  return {
    verdict: asVerdict(answered.value),
    inputTokens: answered.inputTokens,
    outputTokens: answered.outputTokens,
  };
}

/**
 * Two documents for the same brief, side by side.
 *
 * Absolute scores drift — a judge that has seen forty mediocre decks grades
 * the forty-first generously — and a delta between two phases made of two
 * absolute scores inherits all of that. A pairwise call against the recorded
 * baseline output, and against a human-designed reference where one exists,
 * asks the only question that survives drift: is this one better.
 *
 * Which document is `a` is randomised by the caller. A judge shown the new
 * work second, every time, learns where to find it.
 */
export async function judgePair(input: {
  brief: Brief;
  a: JudgeImage;
  b: JudgeImage;
  call: VisionCall;
}): Promise<JudgeResult<PairwiseVerdict>> {
  const answered = await input.call({
    system: rubricPrompt(),
    text: [
      briefContext(input.brief),
      '',
      `Two documents answer this brief. The first image is "${input.a.label}", the second is "${input.b.label}".`,
      'Say which is better as a document to send to a client, and by how much. Judge the rubric in order: a failure at a lower level outranks any advantage above it.',
    ].join('\n'),
    images: [input.a, input.b],
    schema: PAIRWISE_SCHEMA,
  });
  const record = answered.value as Partial<PairwiseVerdict> | null;
  if (
    !record ||
    (record.winner !== 'a' && record.winner !== 'b' && record.winner !== 'tie')
  ) {
    throw new JudgeError(
      `The judge answered something that is not a comparison: ${JSON.stringify(answered.value).slice(0, 200)}`
    );
  }
  return {
    verdict: {
      winner: record.winner,
      margin: record.margin ?? 'slight',
      rationale: record.rationale ?? '',
    },
    inputTokens: answered.inputTokens,
    outputTokens: answered.outputTokens,
  };
}

/**
 * The real vision call, over the Anthropic SDK.
 *
 * Lazily imported for the same reason the agent driver is: the harness's pure
 * modules load, test and typecheck on a machine with no credentials.
 */
export function anthropicVision(options: {
  model: string;
  maxTokens?: number;
}): VisionCall {
  return async (input) => {
    const { default: Anthropic } = await import('@anthropic-ai/sdk');
    const client = new Anthropic();
    const message = await client.messages.create({
      model: options.model,
      max_tokens: options.maxTokens ?? 2000,
      system: input.system,
      messages: [
        {
          role: 'user',
          content: [
            ...input.images.map((image) => ({
              type: 'image' as const,
              source: {
                type: 'base64' as const,
                media_type: 'image/png' as const,
                data: image.png.toString('base64'),
              },
            })),
            {
              type: 'text' as const,
              text: `${input.text}\n\nAnswer with JSON matching this schema and nothing else:\n${JSON.stringify(input.schema)}`,
            },
          ],
        },
      ],
    });

    const text = message.content
      .flatMap((block) =>
        block.type === 'text' && typeof block.text === 'string'
          ? [block.text]
          : []
      )
      .join('');

    return {
      value: parseJson(text),
      inputTokens: message.usage.input_tokens,
      outputTokens: message.usage.output_tokens,
    };
  };
}

/** The JSON in a reply, whether or not the model wrapped it in a fence. */
export function parseJson(text: string): unknown {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(text);
  const body = (fenced ? fenced[1] : text).trim();
  const start = body.indexOf('{');
  const end = body.lastIndexOf('}');
  if (start === -1 || end <= start) {
    throw new JudgeError(
      `No JSON object in the judge's reply: ${text.slice(0, 200)}`
    );
  }
  try {
    return JSON.parse(body.slice(start, end + 1));
  } catch (error) {
    throw new JudgeError(
      `The judge's reply is not valid JSON: ${
        error instanceof Error ? error.message : String(error)
      }`
    );
  }
}
