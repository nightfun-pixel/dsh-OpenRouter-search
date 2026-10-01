/**
 * OpenRouter-backed search provider for the dsh web capability seam (`ctx.web`).
 *
 * Registers provider id `openrouter`. One `web_search` call becomes one OpenRouter Chat
 * Completions request carrying the `openrouter:web_search` server tool pinned to the
 * Parallel engine; OpenRouter runs the search server-side and returns a grounded answer in
 * `choices[0].message.content` plus standardized `url_citation` annotations, which this
 * provider maps onto the seam's `WebSearchResult`. The shipped `web_search` tool then
 * renders the answer and its sources unchanged.
 *
 * Dependency-free on purpose. A profile-installed bundle resolves bare specifiers from its
 * own directory, which cannot see the dsh installation's `node_modules`, so this module
 * imports nothing at all and relies on the global `fetch`. That includes the config schema:
 * `Config` below is a hand-written Standard Schema carrying a schemastery-shaped `toJSON()`,
 * which is exactly the two things the host reads (Cordis validates through
 * `Config['~standard']`, `dsh-settings` projects through `Config.toJSON()`).
 *
 * Authentication never asks the user for a key. `OPENROUTER_API_KEY` resolves through
 * `ctx.credentials` — the same reference the profile's `llm-pi-ai` row already uses for
 * chat — and falls back to the launching process environment.
 *
 * @module @local/dsh-openrouter-web-search
 */

/** Stable provider id this bundle registers with `ctx.web`; the `web` row selects it. */
const PROVIDER_ID = 'openrouter';

/** Default OpenRouter API base, including `/v1`; `/chat/completions` is appended. */
const DEFAULT_BASE_URL = 'https://openrouter.ai/api/v1';

/** Default grounding model. Kept equal to the profile's chat model. */
const DEFAULT_MODEL = 'deepseek/deepseek-v4.1-flash';

/** Credential reference resolved through `ctx.credentials`. */
const DEFAULT_API_KEY_ENV = 'OPENROUTER_API_KEY';

/** Wall-clock bound on one search, including OpenRouter's own search and model turn. */
const DEFAULT_TIMEOUT_MS = 120000;

/**
 * Search engine. Fixed to Parallel by product decision, so it is a constant rather than a
 * setting: the settings card exposes the mode and the context budget instead.
 */
const SEARCH_ENGINE = 'parallel';

/** Parallel modes this provider accepts, in the order the settings card offers them. */
const MODES = ['fast', 'advanced'];

/** Default Parallel mode: `fast` is ~550 ms at $1 per 1,000 requests. */
const DEFAULT_MODE = 'fast';

/** Parallel context-size presets: total characters across all results. */
const CONTEXT_SIZES = ['low', 'medium', 'high'];

/** Default context size. `medium` is Parallel's own default. */
const DEFAULT_CONTEXT_SIZE = 'medium';

/** Default results per search call. */
const DEFAULT_MAX_RESULTS = 5;

/** OpenRouter's server tool accepts `max_results` up to 25; the card offers up to this. */
const MAX_RESULTS_CEILING = 10;

/**
 * Characters of one `url_citation.content` excerpt kept as the source snippet. A single
 * grounded turn can return dozens of citations, so the provider bounds each one.
 */
const SNIPPET_LIMIT = 600;

/** Characters of one citation title kept. */
const TITLE_LIMIT = 300;

/** Attribution header sent on every request. */
const USER_AGENT = 'deepseek-harness-openrouter-web-search/1.1.0';

/**
 * Environment overrides for everything the settings card does NOT own. The three search
 * controls live in the profile patch and are edited from Settings > Plugins.
 */
const ENV = {
  model: 'DSH_OPENROUTER_SEARCH_MODEL',
  baseURL: 'DSH_OPENROUTER_SEARCH_BASE_URL',
  apiKeyEnv: 'DSH_OPENROUTER_SEARCH_API_KEY_ENV',
  timeoutMs: 'DSH_OPENROUTER_SEARCH_TIMEOUT_MS',
};

/**
 * Live search controls, written by {@link validateConfig} on every config resolution and
 * read by the provider at each operation. Held here rather than on the provider because a
 * settings save re-resolves the row config; reading through this object keeps the next
 * search current whether or not the plugin body is re-run.
 */
const current = {
  mode: DEFAULT_MODE,
  searchContextSize: DEFAULT_CONTEXT_SIZE,
  maxResults: DEFAULT_MAX_RESULTS,
};

/**
 * Failure carrying the seam's machine-routable `code` and a message written for the model.
 *
 * A local class rather than `@deepseek-ai/dsh-web`'s `WebError` because importing that
 * package would resolve to a second copy outside the host's module graph. The tool layer
 * narrows with `instanceof HarnessError`, which this cannot satisfy, so the failure reaches
 * the model as `Error: <message>` — hence every message states its own cause and the fix.
 */
class WebError extends Error {
  /**
   * @param {string} message - human-readable failure, already carrying its own guidance.
   * @param {string} code - stable failure class, per the seam's open-string contract.
   * @param {{ cause?: unknown }} [options] - standard `ErrorOptions`.
   */
  constructor(message, code, options) {
    super(message, options);
    this.name = 'WebError';
    this.code = code;
  }
}

/** Read one environment override, treating blank as absent. */
function envText(name) {
  const value = process.env[name];
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
}

/** Read one integer environment override, clamped to `[min, max]`; blank or unparsable falls back. */
function envInt(name, fallback, min, max) {
  const raw = envText(name);
  if (raw === undefined) return fallback;
  const parsed = Number(raw);
  return Number.isInteger(parsed) ? Math.min(Math.max(parsed, min), max) : fallback;
}

/**
 * Snapshot the options one operation runs with. Read per operation rather than cached, so a
 * changed environment or a saved setting reaches the next search.
 * @returns {{ endpoint: string, model: string, apiKeyEnv: string, timeoutMs: number, mode: string, searchContextSize: string, maxResults: number }}
 */
function resolveOptions() {
  const base = (envText(ENV.baseURL) ?? DEFAULT_BASE_URL).replace(/\/+$/u, '');
  return {
    endpoint: `${base}/chat/completions`,
    model: envText(ENV.model) ?? DEFAULT_MODEL,
    apiKeyEnv: envText(ENV.apiKeyEnv) ?? DEFAULT_API_KEY_ENV,
    timeoutMs: envInt(ENV.timeoutMs, DEFAULT_TIMEOUT_MS, 1000, 600000),
    mode: current.mode,
    searchContextSize: current.searchContextSize,
    maxResults: current.maxResults,
  };
}

// ---------------------------------------------------------------------------
// Config: a hand-written native Schemastery graph. No schema library is imported.
//
// The host reads exactly three things off a plugin's Config export:
//   * Cordis mounts the row through the Standard Schema face, `Config['~standard'].validate`.
//   * `dsh-app-boot` recognises the graph by `Symbol.for('schemastery') === true`, a string
//     `type`, and an object `meta`, then walks `dict` to project a JSON Schema.
//   * `dsh-settings` rebuilds a real Schemastery schema from `Config.toJSON()` and keeps the
//     fields whose nearest volatile ancestor makes them live-editable.
//
// Each field is volatile and the root is not — the shape the shipped search provider uses.
// ---------------------------------------------------------------------------

/** The key Schemastery brands its schema nodes with; a global symbol, reachable without importing it. */
const SCHEMA_SYMBOL = Symbol.for('schemastery');

/**
 * Build one node of the native schema graph.
 *
 * Every node carries its own `toJSON`, because `dsh-settings` serializes a volatile field
 * node on its own (`new z(child.toJSON())`) and not only the root.
 */
function schemaNode(type, meta, extra = {}) {
  return {
    [SCHEMA_SYMBOL]: true,
    type,
    meta,
    toJSON() {
      return toSchemaJson(this);
    },
    ...extra,
  };
}

/** The three live-editable search controls. */
const FIELD_NODES = {
  mode: schemaNode('string', { volatile: true, default: DEFAULT_MODE, description: 'Parallel search mode: fast or advanced.' }),
  searchContextSize: schemaNode('string', { volatile: true, default: DEFAULT_CONTEXT_SIZE, description: 'Search context budget: low, medium, or high.' }),
  maxResults: schemaNode('number', { volatile: true, step: 1, min: 1, max: MAX_RESULTS_CEILING, default: DEFAULT_MAX_RESULTS, description: 'Results per search call.' }),
};

/** The root graph: a plain object over those fields. */
const CONFIG_SCHEMA = schemaNode('object', { default: {} }, { dict: FIELD_NODES });

/**
 * Serialize a schema graph the way Schemastery does: a root uid plus a refs table in which
 * every nested node appears as the uid number pointing back into it. Derived from the graph
 * above rather than written out beside it, so the two cannot drift apart.
 *
 * @param {object} root - the graph node to serialize.
 * @returns {{ uid: number, refs: Record<number, object> }} the serialized form.
 */
function toSchemaJson(root) {
  const refs = {};
  const uids = new Map();
  let next = 7400;
  const encode = (node) => {
    const known = uids.get(node);
    if (known !== undefined) return known;
    const uid = next++;
    uids.set(node, uid);
    refs[uid] = {};
    const plain = { type: node.type, meta: node.meta };
    if (node.dict !== undefined) plain.dict = Object.fromEntries(Object.entries(node.dict).map(([key, child]) => [key, encode(child)]));
    if (node.inner !== undefined) plain.inner = encode(node.inner);
    if (node.list !== undefined) plain.list = node.list.map(encode);
    refs[uid] = plain;
    return uid;
  };
  const uid = encode(root);
  return { uid, refs };
}

/** Reject a value, naming the field and what it accepts. */
function issue(path, value, accepts) {
  return { message: `${path} ${JSON.stringify(value)} is not one of ${accepts.join(', ')}`, path: [path] };
}

/**
 * Normalize one raw config into the three live search controls.
 *
 * Defaults are applied, so a row that declares nothing still yields a complete section and
 * the settings card shows the effective value of every field. A value outside the accepted
 * set is an issue rather than a silent fallback: the save that wrote it reports failure
 * instead of storing something the user did not choose.
 *
 * @param {unknown} raw - the row's raw config.
 * @returns {{ value: object } | { issues: object[] }} the resolved section or the problems found.
 */
function validateConfig(raw) {
  const input = raw !== null && typeof raw === 'object' ? raw : {};
  const issues = [];

  const readEnum = (field, allowed, fallback) => {
    const value = input[field];
    if (value === undefined || value === null || value === '') return fallback;
    const normalized = typeof value === 'string' ? value.trim().toLowerCase() : value;
    if (allowed.includes(normalized)) return normalized;
    issues.push(issue(field, value, allowed));
    return fallback;
  };

  const mode = readEnum('mode', MODES, DEFAULT_MODE);
  const searchContextSize = readEnum('searchContextSize', CONTEXT_SIZES, DEFAULT_CONTEXT_SIZE);

  let maxResults = DEFAULT_MAX_RESULTS;
  const rawMaxResults = input.maxResults;
  if (rawMaxResults !== undefined && rawMaxResults !== null && rawMaxResults !== '') {
    const parsed = typeof rawMaxResults === 'number' ? rawMaxResults : Number(rawMaxResults);
    if (Number.isInteger(parsed) && parsed >= 1 && parsed <= MAX_RESULTS_CEILING) maxResults = parsed;
    else issues.push({ message: `maxResults ${JSON.stringify(rawMaxResults)} must be a whole number from 1 to ${MAX_RESULTS_CEILING}`, path: ['maxResults'] });
  }

  if (issues.length > 0) return { issues };

  Object.assign(current, { mode, searchContextSize, maxResults });
  return { value: { mode, searchContextSize, maxResults } };
}

/**
 * The plugin's config schema.
 *
 * `~standard` is the Standard Schema v1 contract Cordis validates through; `meta.volatile`
 * and `toJSON()` are the two things `dsh-settings` reads to list this entry as a live,
 * editable settings section.
 */
const Config = {
  ...CONFIG_SCHEMA,
  '~standard': {
    version: 1,
    // The client recognises a Schemastery-shaped schema by this exact vendor string and
    // otherwise falls back to a plain comparison. This object IS Schemastery-shaped, so it
    // answers with the same vendor rather than inventing one the client cannot classify.
    vendor: 'schemastery',
    validate: validateConfig,
  },
  toJSON() {
    return toSchemaJson(CONFIG_SCHEMA);
  },
};

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

/** Render a thrown value for a diagnostic message, including a fetch wrapper's cause. */
function describe(error) {
  if (!(error instanceof Error)) return String(error);
  const cause = error.cause;
  const causeText = cause instanceof Error && cause.message !== error.message ? `: ${cause.message}` : '';
  return `${error.message}${causeText}`;
}

/** Collapse a provider excerpt to one line so it renders as a single snippet. */
function collapse(value) {
  if (typeof value !== 'string') return undefined;
  const text = value.replace(/\s+/gu, ' ').trim();
  return text.length > 0 ? text : undefined;
}

/** Trim text to `limit` characters, marking a cut. */
function clip(text, limit) {
  if (text === undefined) return undefined;
  return text.length <= limit ? text : `${text.slice(0, limit - 1).trimEnd()}…`;
}

/** Throw the provider's cancellation error when the caller already aborted. */
function throwIfAborted(signal) {
  if (signal?.aborted === true) throw aborted(signal);
}

/** Build the cancellation failure while retaining the caller's reason. */
function aborted(signal, fallback) {
  const reason = signal?.reason;
  const detail = reason instanceof Error ? reason.message : reason === undefined ? undefined : String(reason);
  return new WebError(
    `OpenRouter web search aborted${detail === undefined ? '' : `: ${detail}`}`,
    'WEB_ABORTED',
    reason === undefined ? { cause: fallback } : { cause: reason },
  );
}

/** Build the timeout failure; a timeout is the one cancellation the caller did not ask for. */
function timeoutError(options, cause) {
  return new WebError(
    `OpenRouter web search timed out after ${options.timeoutMs} ms. Raise ${ENV.timeoutMs} in the launching environment if the query legitimately needs longer.`,
    'WEB_PROVIDER_TIMEOUT',
    cause === undefined ? undefined : { cause },
  );
}

/**
 * Build the failure for anything that went wrong after dispatch began, naming the endpoint and
 * model in use so a misconfiguration is diagnosable from the tool result alone.
 */
function endpointError(options, message, cause) {
  return new WebError(
    `${message}\n\nThe request used endpoint ${JSON.stringify(options.endpoint)} with model ${JSON.stringify(options.model)}. Set ${ENV.baseURL} or ${ENV.model} in the launching environment to change them.`,
    'WEB_PROVIDER_ERROR',
    cause === undefined ? undefined : { cause },
  );
}

/**
 * Resolve the OpenRouter credential for one operation, never retaining it on the provider.
 * @param {object} ctx - the plugin context, read per operation so a changed credential is picked up.
 * @param {string} apiKeyEnv - credential reference to resolve.
 * @param {AbortSignal | undefined} signal - the surrounding search's cancellation signal.
 * @returns {Promise<string>} the resolved non-empty key.
 * @throws {WebError} `WEB_PROVIDER_CREDENTIAL_MISSING` when no source holds a value.
 */
async function resolveApiKey(ctx, apiKeyEnv, signal) {
  throwIfAborted(signal);
  const credentials = ctx.get('credentials');
  if (credentials !== undefined) {
    let resolved;
    try {
      resolved = await credentials.resolve(apiKeyEnv);
    } catch (error) {
      throw new WebError(
        `OpenRouter web search could not read the credential store for "${apiKeyEnv}": ${describe(error)}`,
        'WEB_PROVIDER_ERROR',
        { cause: error },
      );
    }
    const value = resolved?.value;
    if (typeof value === 'string' && value.length > 0) return value;
  }
  const ambient = process.env[apiKeyEnv];
  if (typeof ambient === 'string' && ambient.length > 0) return ambient;
  throw new WebError(
    `OpenRouter web search has no credential: "${apiKeyEnv}" is not configured. Store it through the credentials service, or export ${apiKeyEnv} in the environment that launched the harness. Web search keeps working for other queries once a value is present; no restart is needed.`,
    'WEB_PROVIDER_CREDENTIAL_MISSING',
  );
}

/** Read the assistant answer, tolerating both the string and content-part shapes. */
function readContent(content) {
  if (typeof content === 'string') {
    const text = content.trim();
    return text.length > 0 ? text : undefined;
  }
  if (Array.isArray(content)) {
    const text = content
      .filter((part) => part?.type === 'text' && typeof part.text === 'string')
      .map((part) => part.text)
      .join('')
      .trim();
    return text.length > 0 ? text : undefined;
  }
  return undefined;
}

/**
 * Build the user turn.
 *
 * The server tool lets the model decide whether to search, while this provider answers a
 * tool whose contract is "return sources", so the instruction makes the search mandatory
 * rather than optional. A URL query additionally asks for that exact page.
 *
 * @param {string} query - the caller's query.
 * @returns {string} the prompt.
 */
function buildPrompt(query) {
  const trimmed = query.trim();
  if (URL.canParse(trimmed)) {
    return `Run a web search for this exact URL, read the page it returns, and answer using that page's content. Do not answer from prior knowledge. Cite it as a markdown link.\n\nURL: ${trimmed}`;
  }
  return `Run a web search and answer the query below from the search results. You must search before answering; do not answer from prior knowledge. Be concise and factual, and cite every claim with markdown links to the sources.\n\nQuery: ${trimmed}`;
}

/**
 * Map an OpenRouter Chat Completions response onto the seam's normalized search result.
 * Sources come from the standardized `url_citation` annotations, deduped by URL because an
 * agentic turn can cite the same page more than once. The seam owns the final `maxResults`
 * truncation, so `truncated` is always `false` here.
 *
 * @param {unknown} payload - the parsed response body.
 * @param {{ model: string }} options - the operation's snapshot, for diagnostics only.
 * @returns {{ content?: string, sources: Array<{ url: string, title?: string, snippet?: string }>, truncated: false }}
 * @throws {WebError} `WEB_PROVIDER_ERROR` when the response carries neither answer nor citation.
 */
function mapResponse(payload, options) {
  const message = payload?.choices?.[0]?.message;
  const content = readContent(message?.content);
  const annotations = Array.isArray(message?.annotations) ? message.annotations : [];
  const seen = new Set();
  const sources = [];
  for (const annotation of annotations) {
    if (annotation?.type !== 'url_citation') continue;
    const citation = annotation.url_citation;
    const url = typeof citation?.url === 'string' ? citation.url.trim() : '';
    if (url.length === 0 || seen.has(url)) continue;
    seen.add(url);
    const title = clip(collapse(citation?.title), TITLE_LIMIT);
    const snippet = clip(collapse(citation?.content), SNIPPET_LIMIT);
    sources.push({
      url,
      ...(title === undefined ? {} : { title }),
      ...(snippet === undefined ? {} : { snippet }),
    });
  }
  if (content === undefined && sources.length === 0) {
    throw new WebError(
      `OpenRouter returned neither an answer nor url_citation annotations for model ${JSON.stringify(options.model)}. The server tool may not have run: confirm the request carries tools[].type "openrouter:web_search" and that the model supports tool calling.`,
      'WEB_PROVIDER_ERROR',
    );
  }
  return {
    ...(content === undefined ? {} : { content }),
    sources,
    truncated: false,
  };
}

/** Read an error response's detail without letting a body failure mask the HTTP status. */
async function readErrorDetail(response, signal) {
  try {
    const parsed = await response.json();
    const detail = typeof parsed?.error === 'string' ? parsed.error : parsed?.error?.message ?? parsed?.message;
    return typeof detail === 'string' && detail.length > 0 ? detail : undefined;
  } catch (error) {
    if (signal?.aborted === true) throw aborted(signal, error);
    return undefined;
  }
}

/** Map a non-2xx OpenRouter response to the failure class that names its fix. */
function statusError(status, detail, options) {
  const suffix = detail === undefined ? '' : `: ${detail}`;
  if (status === 401 || status === 403) {
    return new WebError(
      `OpenRouter rejected the credential behind "${options.apiKeyEnv}" (HTTP ${status})${suffix}. Replace that stored value with a valid OpenRouter API key; the search endpoint itself does not need changing.`,
      'WEB_PROVIDER_CREDENTIAL_INVALID',
    );
  }
  if (status === 402) {
    return new WebError(
      `OpenRouter refused the search for lack of credits (HTTP 402)${suffix}. Web search is billed per request in addition to the model turn, so the account needs credit even for free models.`,
      'WEB_PROVIDER_QUOTA',
    );
  }
  if (status === 429) {
    return new WebError(
      `OpenRouter rate-limited the search (HTTP 429)${suffix}. Retrying the same query shortly is safe.`,
      'WEB_PROVIDER_RATE_LIMITED',
    );
  }
  return endpointError(options, `OpenRouter API error (HTTP ${status})${suffix}`);
}

/**
 * The OpenRouter-backed search provider.
 *
 * HTTP redirects fail rather than being followed, so a redirected credential never reaches a
 * third party. Failures after dispatch name the endpoint, the model, and the fix.
 */
class OpenRouterSearchProvider {
  /**
   * @param {object} ctx - the plugin context, held only to read `ctx.credentials` per operation.
   */
  constructor(ctx) {
    this.ctx = ctx;
  }

  /** @type {string} */
  id = PROVIDER_ID;

  /** Cheap local usability check; never makes a network call, so it cannot prove the key works. */
  available() {
    const options = resolveOptions();
    return options.model.length > 0 && URL.canParse(options.endpoint);
  }

  /**
   * Run one search through the OpenRouter web-search server tool.
   * @param {{ query: string, maxResults?: number }} request - the query and the seam's bound.
   * @param {AbortSignal} [signal] - cancellation forwarded to the request.
   * @returns {Promise<object>} the normalized result the seam caps and renders.
   */
  async search(request, signal) {
    const options = resolveOptions();
    const apiKey = await resolveApiKey(this.ctx, options.apiKeyEnv, signal);
    throwIfAborted(signal);

    // The caller's bound and the saved setting are both upper bounds: send the lower one.
    const requested = request.maxResults === undefined ? options.maxResults : Math.min(request.maxResults, options.maxResults);
    const maxResults = Math.min(Math.max(requested, 1), MAX_RESULTS_CEILING);

    const body = {
      model: options.model,
      messages: [{ role: 'user', content: buildPrompt(request.query) }],
      tools: [
        {
          type: 'openrouter:web_search',
          parameters: {
            engine: SEARCH_ENGINE,
            mode: options.mode,
            max_results: maxResults,
            search_context_size: options.searchContextSize,
          },
        },
      ],
    };

    const timeoutSignal = AbortSignal.timeout(options.timeoutMs);
    const combined = signal === undefined ? timeoutSignal : AbortSignal.any([signal, timeoutSignal]);

    let response;
    try {
      response = await fetch(options.endpoint, {
        method: 'POST',
        redirect: 'error',
        headers: {
          authorization: `Bearer ${apiKey}`,
          'content-type': 'application/json',
          accept: 'application/json',
          'user-agent': USER_AGENT,
        },
        body: JSON.stringify(body),
        signal: combined,
      });
    } catch (error) {
      if (signal?.aborted === true) throw aborted(signal, error);
      if (timeoutSignal.aborted) throw timeoutError(options, error);
      throw endpointError(options, `OpenRouter search request failed: ${describe(error)}`, error);
    }

    if (!response.ok) throw statusError(response.status, await readErrorDetail(response, signal), options);

    let payload;
    try {
      payload = await response.json();
    } catch (error) {
      if (signal?.aborted === true) throw aborted(signal, error);
      throw endpointError(options, `OpenRouter returned an unprocessable response body: ${describe(error)}`, error);
    }
    return mapResponse(payload, options);
  }
}

/** Cordis plugin name used by loader diagnostics. */
export const name = 'openrouter-web-search';

/** The web seam this provider registers into. */
export const inject = ['web'];

export { Config };

/**
 * Register the OpenRouter search provider with `ctx.web`.
 *
 * The registration is disposed with this plugin's fiber, so disabling the bundle removes the
 * provider and leaves the seam's selection pointing at a missing id — which is why the
 * companion `cordis.patch.yml` sets `web.searchProvider` in the same layer.
 *
 * The `Config` export above deliberately leaves the automatic settings page enabled: the row's
 * own configure control renders these three fields from the schema, and the browser half adds
 * the richer card with its two selects. That is the same shape the shipped search provider
 * uses, and it keeps the settings reachable even if the card's bundle is not loaded yet.
 *
 * @param {object} ctx - the plugin context, carrying the injected `web` service.
 */
export function apply(ctx) {
  ctx.web.registerSearchProvider(new OpenRouterSearchProvider(ctx));
}


