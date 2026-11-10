import { setTimeout as sleep } from 'node:timers/promises';
import { z } from 'zod';
import { aiConfigured, type Config } from '../../config.js';
import { HttpError } from '../../errors.js';
import { log } from '../../logger.js';
import { describeIssues } from '../../schemas.js';

type Message = { role: 'system' | 'user' | 'assistant'; content: string };

interface ChatJsonOptions<S extends z.ZodType> {
  system: string;
  user: string;
  schema: S;
}

export class AiError extends HttpError {
  constructor(status: number, message: string, code: string) {
    super(status, message, code);
  }
}

function providerError(status: number): AiError {
  if (status === 401 || status === 403) {
    return new AiError(502, 'The AI provider rejected the API key. Check AI_API_KEY and AI_BASE_URL on the server.', 'ai_auth');
  }
  if (status === 404) {
    return new AiError(502, 'The AI provider did not recognise the model or endpoint. Check AI_MODEL and AI_BASE_URL on the server.', 'ai_not_found');
  }
  if (status === 429) {
    return new AiError(503, 'The AI provider is rate-limiting requests or the account is out of quota. Please try again in a minute.', 'ai_rate_limited');
  }
  if (status < 500 && status !== 408) {
    return new AiError(502, 'The AI provider rejected the request. Check the server model configuration.', 'ai_request_rejected');
  }
  return new AiError(502, 'The AI provider returned an error. Please try again.', 'ai_provider_error');
}

async function callProvider(config: Config, model: string, messages: Message[], jsonMode: boolean, deadline: AbortSignal): Promise<string> {
  const body: Record<string, unknown> = { model, messages };
  if (jsonMode) body.response_format = { type: 'json_object' };
  if (config.ai.temperature !== undefined) body.temperature = config.ai.temperature;

  const signal = AbortSignal.any([deadline, AbortSignal.timeout(config.ai.timeoutMs)]);
  try {
    const response = await fetch(new URL(config.ai.baseUrl + '/chat/completions'), {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: 'Bearer ' + config.ai.apiKey },
      body: JSON.stringify(body),
      signal,
    });

    if (!response.ok) {
      // Some compatible providers reject response_format. The prompt still requests JSON.
      if (jsonMode && response.status === 400 && /response_format|json_object|json mode/i.test(await response.text())) {
        return callProvider(config, model, messages, false, deadline);
      }
      if (!response.bodyUsed) await response.body?.cancel();
      log.warn('AI provider responded with HTTP ' + response.status);
      throw providerError(response.status);
    }

    const payload: unknown = await response.json().catch((err: unknown) => {
      if (signal.aborted) throw err;
      return undefined;
    });
    const parsed = completionSchema.safeParse(payload);
    const content = parsed.success ? parsed.data.choices[0]?.message.content.trim() : undefined;
    if (!content) throw new AiError(502, 'The AI provider returned an invalid or empty response. Please try again.', 'ai_invalid_response');
    return content;
  } catch (err) {
    if (err instanceof AiError) throw err;
    if (signal.aborted) throw timeoutError();
    throw new AiError(502, 'Could not reach the AI provider. Check AI_BASE_URL and your network.', 'ai_unreachable');
  }
}

const timeoutError = () => new AiError(504, 'The AI provider took too long to respond. Please try again.', 'ai_timeout');
const RETRYABLE = new Set(['ai_rate_limited', 'ai_provider_error', 'ai_timeout', 'ai_unreachable']);
const MAX_RETRIES = 2;
const completionSchema = z.object({ choices: z.array(z.object({ message: z.object({ content: z.string() }) })) });

/** Pull a JSON object out of a model reply, tolerating code fences and surrounding prose. */
export function parseJsonReply(reply: string): unknown {
  const unfenced = reply.replace(/^\s*```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '');
  try {
    const parsed: unknown = JSON.parse(unfenced);
    return parsed;
  } catch {
    const start = unfenced.indexOf('{');
    const end = unfenced.lastIndexOf('}');
    if (start === -1 || end <= start) throw new Error('no JSON object found');
    const parsed: unknown = JSON.parse(unfenced.slice(start, end + 1));
    return parsed;
  }
}

/**
 * Ask the model for JSON and validate it against `schema`. If the reply does not parse or
 * validate, the model gets one chance to correct it before the request fails.
 */
export async function chatJson<S extends z.ZodType>(
  config: Config,
  options: ChatJsonOptions<S>,
): Promise<{ data: z.infer<S>; model: string }> {
  if (!aiConfigured(config)) {
    throw new AiError(503, 'No AI API key is configured on the server.', 'ai_not_configured');
  }

  const messages: Message[] = [
    { role: 'system', content: options.system },
    { role: 'user', content: options.user },
  ];

  const models = [...new Set([config.ai.model, ...config.ai.fallbackModels])];
  const deadline = AbortSignal.timeout(config.ai.totalTimeoutMs);
  let retries = 0;
  let model = config.ai.model;
  const ask = async (): Promise<string> => {
    for (;;) {
      try {
        return await callProvider(config, model, messages, config.ai.jsonMode, deadline);
      } catch (err) {
        if (deadline.aborted) throw timeoutError();
        if (!(err instanceof AiError) || !RETRYABLE.has(err.code) || retries >= MAX_RETRIES) throw err;
        const delay = config.ai.retryDelayMs * 2 ** retries;
        retries++;
        model = models[retries] ?? model;
        log.warn('Retrying a transient AI provider failure');
        await sleep(delay, undefined, { signal: deadline }).catch(() => { throw timeoutError(); });
      }
    }
  };

  for (let attempt = 0; attempt < 2; attempt++) {
    const reply = await ask();
    let problem: string;
    try {
      const result = options.schema.safeParse(parseJsonReply(reply));
      if (result.success) return { data: result.data, model };
      problem = describeIssues(result.error).join('; ');
    } catch {
      problem = 'the reply was not a single valid JSON object';
    }
    messages.push(
      { role: 'assistant', content: reply },
      {
        role: 'user',
        content: `That reply was rejected: ${problem}. Reply again with ONLY a single valid JSON object matching the required structure. Follow all the original rules.`,
      },
    );
  }

  throw new AiError(502, 'The AI returned a response in an unexpected format. Please try again.', 'ai_invalid_response');
}
