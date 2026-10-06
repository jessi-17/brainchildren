// Optional AI, using your own Anthropic API key. The key stays on this
// computer (data/secrets.json, a .env file, or ANTHROPIC_API_KEY) and is
// never sent to the browser. Nothing is sent to the API until you switch AI
// on and click something that uses it. Every feature can show exactly what
// it would send first.
import { promises as fs } from 'node:fs';
import path from 'node:path';

export const MODELS = {
  'claude-opus-5-5': { label: 'Claude Opus 5.5 (best)', input: 4, output: 20, effort: true, fallback: true },
  'claude-sonnet-5-5': { label: 'Claude Sonnet 5.5 (balanced)', input: 2, output: 10, effort: true, fallback: true },
  'claude-haiku-4-5': { label: 'Claude Haiku 4.5 (cheapest)', input: 1, output: 5, effort: false, fallback: false },
};
export const DEFAULT_MODEL = 'claude-opus-5-5';

export class AIError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

export function createAI({ appDir, dataDir, settings, save }) {
  const secretsFile = path.join(dataDir, 'secrets.json');
  let Anthropic = null;
  let sdkMissing = false;

  async function loadSdk() {
    if (Anthropic) return Anthropic;
    try {
      Anthropic = (await import('@anthropic-ai/sdk')).default;
      sdkMissing = false;
      return Anthropic;
    } catch {
      sdkMissing = true;
      throw new AIError('needs-sdk', 'AI needs one extra package. run "npm install" in the brainchildren folder, then restart it.');
    }
  }

  async function findKey() {
    try {
      const s = JSON.parse(await fs.readFile(secretsFile, 'utf8'));
      if (s.anthropicKey) return { key: s.anthropicKey, source: 'saved' };
    } catch {}
    try {
      const env = await fs.readFile(path.join(appDir, '.env'), 'utf8');
      const m = env.match(/^\s*ANTHROPIC_API_KEY\s*=\s*["']?([^"'\s]+)/m);
      if (m) return { key: m[1], source: '.env' };
    } catch {}
    if (process.env.ANTHROPIC_API_KEY) return { key: process.env.ANTHROPIC_API_KEY, source: 'environment' };
    return { key: null, source: null };
  }

  async function status() {
    const { key, source } = await findKey();
    if (!Anthropic && !sdkMissing) await loadSdk().catch(() => {});
    const ai = settings().ai;
    return {
      on: ai.on,
      sdk: !!Anthropic,
      hasKey: !!key,
      keySource: source,
      keyHint: key ? `…${key.slice(-4)}` : null,
      model: ai.model,
      models: Object.fromEntries(Object.entries(MODELS).map(([id, m]) => [id, { label: m.label, input: m.input, output: m.output }])),
      features: ai.features,
      usage: ai.usage,
    };
  }

  async function setKey(key) {
    let s = {};
    try {
      s = JSON.parse(await fs.readFile(secretsFile, 'utf8'));
    } catch {}
    if (key) {
      if (!/^sk-ant-[\w-]{20,}$/.test(key)) throw new AIError('bad-key', "that doesn't look like an Anthropic API key (they start with sk-ant-)");
      s.anthropicKey = key;
    } else delete s.anthropicKey;
    await fs.mkdir(dataDir, { recursive: true });
    await fs.writeFile(secretsFile, JSON.stringify(s, null, 2), { mode: 0o600 });
  }

  // one structured call: system prompt + context → JSON matching the schema
  async function call({ system, user, schema, effort = 'low', maxTokens = 16000 }) {
    const ai = settings().ai;
    if (!ai.on) throw new AIError('off', 'AI is switched off. turn it on in settings → AI.');
    const SDK = await loadSdk();
    const { key } = await findKey();
    const client = key ? new SDK({ apiKey: key }) : new SDK();
    const model = MODELS[ai.model] ? ai.model : DEFAULT_MODEL;
    const spec = MODELS[model];
    const params = {
      model,
      max_tokens: maxTokens,
      system,
      messages: [{ role: 'user', content: user }],
      output_config: { format: { type: 'json_schema', schema }, ...(spec.effort ? { effort } : {}) },
    };
    let res;
    try {
      res = spec.fallback
        ? // if a safety check declines, the API retries on its recommended fallback model
          await client.beta.messages.create({ ...params, betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' })
        : await client.messages.create(params);
    } catch (err) {
      if (err instanceof SDK.AuthenticationError) throw new AIError('bad-key', 'the API key was rejected. check it in settings → AI.');
      if (err instanceof SDK.PermissionDeniedError) throw new AIError('denied', "this key isn't allowed to use that model.");
      if (err instanceof SDK.RateLimitError) throw new AIError('rate', 'the API is busy (rate limit). try again in a minute.');
      if (err instanceof SDK.BadRequestError) throw new AIError('bad-request', `the API didn't accept the request: ${err.message}`);
      if (err instanceof SDK.APIConnectionError) throw new AIError('offline', "couldn't reach the API. are you online?");
      if (err instanceof SDK.APIError) throw new AIError('api', `the API had a problem (${err.status}). try again later.`);
      throw err;
    }
    track(res.usage, model);
    if (res.stop_reason === 'refusal') throw new AIError('refusal', "the model declined this one. try rephrasing, or skip it.");
    if (res.stop_reason === 'max_tokens') throw new AIError('too-long', 'the answer got cut off. try again with less to look at.');
    const text = res.content.filter((b) => b.type === 'text').map((b) => b.text).join('');
    try {
      return JSON.parse(text);
    } catch {
      throw new AIError('bad-output', 'the answer came back in an odd shape. try again.');
    }
  }

  function track(usage, model) {
    if (!usage) return;
    const ai = settings().ai;
    const month = new Date().toISOString().slice(0, 7);
    if (ai.usage.month !== month) ai.usage = { month, calls: 0, input: 0, output: 0, cost: 0 };
    const spec = MODELS[model];
    const input = (usage.input_tokens || 0) + (usage.cache_creation_input_tokens || 0) + (usage.cache_read_input_tokens || 0);
    ai.usage.calls++;
    ai.usage.input += input;
    ai.usage.output += usage.output_tokens || 0;
    ai.usage.cost += (input * spec.input + (usage.output_tokens || 0) * spec.output) / 1e6;
    save();
  }

  async function test() {
    const out = await call({
      system: 'You are checking that an API connection works.',
      user: 'Reply with ok set to true and a five-word cheerful greeting for a pixel studio.',
      schema: obj({ ok: { type: 'boolean' }, greeting: { type: 'string' } }),
      maxTokens: 2000,
    });
    return out;
  }

  return { status, setKey, call, test, loadSdk };
}

// JSON schema helper: every object needs additionalProperties: false and required keys
export function obj(properties) {
  return { type: 'object', properties, required: Object.keys(properties), additionalProperties: false };
}
export const arr = (items) => ({ type: 'array', items });
export const S = { type: 'string' };
