// Pre-install verification for @local/dsh-web-search-openrouter.
// Exercises the plugin through a stubbed ctx.web + stubbed global fetch:
// no network, no credential, no profile state touched.
import { apply, name, inject, Config } from '../index.js';
let pass = 0;
let fail = 0;
function check(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) { pass += 1; console.log(`  ok   ${label}`); }
  else { fail += 1; console.log(`  FAIL ${label}\n       expected ${JSON.stringify(expected)}\n       actual   ${JSON.stringify(actual)}`); }
}
function checkMatch(label, value, re) {
  const ok = re.test(String(value));
  if (ok) { pass += 1; console.log(`  ok   ${label}`); }
  else { fail += 1; console.log(`  FAIL ${label}\n       value ${JSON.stringify(value)} did not match ${re}`); }
}

/** Build a ctx that records the provider and answers the optional services the plugin reads. */
function makeCtx({ credential, settingsCalls } = {}) {
  const captured = {};
  const ctx = {
    web: { registerSearchProvider(p) { captured.provider = p; return () => {}; } },
    logger: { warn() {} },
    get(key) {
      if (key === 'credentials') {
        return { async resolve() { return credential === undefined ? undefined : { value: credential, source: 'file' }; } };
      }
      if (key === 'settings') {
        return settingsCalls === undefined ? undefined : { configure(p) { settingsCalls.push(p); } };
      }
      return undefined;
    },
  };
  apply(ctx);
  return { ctx, provider: captured.provider };
}

/** Reset the live section to the defaults the composition layer seeds. */
function resetConfig() {
  Config['~standard'].validate({});
}

const CANNED = {
  model: 'deepseek/deepseek-v4.1-flash',
  choices: [{
    message: {
      role: 'assistant',
      content: '  The answer, grounded.  ',
      annotations: [
        { type: 'url_citation', url_citation: { url: 'https://a.example/x', title: 'A title', content: 'first excerpt   with\nnewlines' } },
        { type: 'url_citation', url_citation: { url: 'https://a.example/x', title: 'duplicate', content: 'ignored' } },
        { type: 'url_citation', url_citation: { url: 'https://b.example/y', title: '  ', content: '' } },
        { type: 'other_annotation', url_citation: { url: 'https://ignored.example/' } },
        { type: 'url_citation', url_citation: { title: 'no url' } },
      ],
    },
  }],
};

function stubFetch(handler) {
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url, init });
    return handler(url, init, calls.length);
  };
  return calls;
}
const okResponse = (payload) => new Response(JSON.stringify(payload), { status: 200, headers: { 'content-type': 'application/json' } });
const errResponse = (status, payload) => new Response(JSON.stringify(payload), { status, headers: { 'content-type': 'application/json' } });

console.log('exports');
check('name', name, 'openrouter-web-search');
check('inject', inject, ['web']);

console.log('config schema: what the host reads');
{
  check('branded as a native schemastery node', Config[Symbol.for('schemastery')], true);
  check('root type', Config.type, 'object');
  check('root meta is an object', typeof Config.meta, 'object');
  check('toJSON is a function', typeof Config.toJSON, 'function');
  check('standard version', Config['~standard'].version, 1);
  check('standard vendor', Config['~standard'].vendor, 'schemastery');
  check('standard validate is a function', typeof Config['~standard'].validate, 'function');

  const json = Config.toJSON();
  check('root uid is a refs key', Object.prototype.hasOwnProperty.call(json.refs, String(json.uid)), true);
  const root = json.refs[String(json.uid)];
  check('serialized root type', root.type, 'object');
  check('declared fields', Object.keys(root.dict), ['mode', 'searchContextSize', 'maxResults']);
  for (const [field, uid] of Object.entries(root.dict)) {
    const child = json.refs[String(uid)];
    check(`${field} serializes to a node`, typeof child, 'object');
    check(`${field} carries a default`, child.meta.default !== undefined, true);
    check(`${field} is volatile`, child.meta.volatile, true);
  }
  check('every dict target exists in refs', Object.values(root.dict).every((uid) => json.refs[String(uid)] !== undefined), true);
  const fieldJson = Config.dict.mode.toJSON();
  check('a field serializes on its own, as dsh-settings asks', fieldJson.refs[String(fieldJson.uid)].type, 'string');
}

console.log('config validation');
{
  check('defaults', Config['~standard'].validate({}), { value: { mode: 'fast', searchContextSize: 'medium', maxResults: 5 } });
  check('explicit values', Config['~standard'].validate({ mode: 'advanced', searchContextSize: 'high', maxResults: 9 }),
    { value: { mode: 'advanced', searchContextSize: 'high', maxResults: 9 } });
  check('case and whitespace normalized', Config['~standard'].validate({ mode: ' ADVANCED ' }).value.mode, 'advanced');
  check('numeric string accepted', Config['~standard'].validate({ maxResults: '7' }).value.maxResults, 7);
  check('unknown mode rejected', 'issues' in Config['~standard'].validate({ mode: 'turbo' }), true);
  check('maxResults above ceiling rejected', 'issues' in Config['~standard'].validate({ maxResults: 25 }), true);
  check('fractional maxResults rejected', 'issues' in Config['~standard'].validate({ maxResults: 2.5 }), true);
  check('issue names its path', Config['~standard'].validate({ mode: 'turbo' }).issues[0].path, ['mode']);
  check('a rejected value does not take effect', Config['~standard'].validate({ maxResults: 99 }), Config['~standard'].validate({ maxResults: 99 }));
  resetConfig();
}

console.log('registration');
{
  const settingsCalls = [];
  const { provider } = makeCtx({ credential: 'sk-test', settingsCalls });
  check('id', provider.id, 'openrouter');
  check('available()', provider.available(), true);
  check('automatic settings page left enabled', settingsCalls, []);
  check('registration survives an absent settings service', makeCtx({ credential: 'sk-test' }).provider.id, 'openrouter');
}

console.log('happy path: server tool request shape + mapping');
{
  resetConfig();
  const { provider } = makeCtx({ credential: 'sk-test-value' });
  const calls = stubFetch(() => okResponse(CANNED));
  const result = await provider.search({ query: '  what is new  ', maxResults: 2 });
  const { url, init } = calls[0];
  check('endpoint', url, 'https://openrouter.ai/api/v1/chat/completions');
  check('method', init.method, 'POST');
  check('redirect', init.redirect, 'error');
  check('auth header', init.headers.authorization, 'Bearer sk-test-value');
  const body = JSON.parse(init.body);
  check('model', body.model, 'deepseek/deepseek-v4.1-flash');
  check('no deprecated plugins array', 'plugins' in body, false);
  check('server tool type', body.tools[0].type, 'openrouter:web_search');
  check('engine fixed to parallel', body.tools[0].parameters.engine, 'parallel');
  check('mode from settings', body.tools[0].parameters.mode, 'fast');
  check('search_context_size from settings', body.tools[0].parameters.search_context_size, 'medium');
  check('max_results is the lower bound', body.tools[0].parameters.max_results, 2);
  check('query trimmed into prompt', /what is new/.test(body.messages[0].content), true);
  checkMatch('search made mandatory', body.messages[0].content, /must search before answering/);
  check('content trimmed', result.content, 'The answer, grounded.');
  check('sources deduped + non-citation dropped', result.sources.map((s) => s.url), ['https://a.example/x', 'https://b.example/y']);
  check('snippet collapsed', result.sources[0].snippet, 'first excerpt with newlines');
  check('blank title omitted', 'title' in result.sources[1], false);
  check('truncated false (seam owns capping)', result.truncated, false);
}

console.log('saved settings reach the next search');
{
  resetConfig();
  Config['~standard'].validate({ mode: 'advanced', searchContextSize: 'high', maxResults: 8 });
  const { provider } = makeCtx({ credential: 'sk-test' });
  const calls = stubFetch(() => okResponse(CANNED));
  await provider.search({ query: 'q' });
  const p = JSON.parse(calls[0].init.body).tools[0].parameters;
  check('mode advanced', p.mode, 'advanced');
  check('context high', p.search_context_size, 'high');
  check('max_results from settings when caller sets none', p.max_results, 8);
  await provider.search({ query: 'q', maxResults: 10 });
  check('caller bound below the setting wins', JSON.parse(calls[1].init.body).tools[0].parameters.max_results, 8);
  resetConfig();
}

console.log('url query gets the read-the-page prompt');
{
  resetConfig();
  const { provider } = makeCtx({ credential: 'sk-test' });
  const calls = stubFetch(() => okResponse(CANNED));
  await provider.search({ query: 'https://example.com/page' });
  const body = JSON.parse(calls[0].init.body);
  checkMatch('prompt names the URL', body.messages[0].content, /this exact URL/);
  check('default max_results', body.tools[0].parameters.max_results, 5);
}

console.log('environment overrides (endpoint, model, credential, timeout only)');
{
  resetConfig();
  process.env.DSH_OPENROUTER_SEARCH_MODEL = 'openai/gpt-5.2';
  process.env.DSH_OPENROUTER_SEARCH_API_KEY_ENV = 'OTHER_KEY';
  process.env.OTHER_KEY = 'sk-other';
  const { provider } = makeCtx();
  const calls = stubFetch(() => okResponse(CANNED));
  await provider.search({ query: 'q' });
  const body = JSON.parse(calls[0].init.body);
  check('model override', body.model, 'openai/gpt-5.2');
  check('engine still parallel', body.tools[0].parameters.engine, 'parallel');
  check('key env override', calls[0].init.headers.authorization, 'Bearer sk-other');
  for (const k of ['DSH_OPENROUTER_SEARCH_MODEL', 'DSH_OPENROUTER_SEARCH_API_KEY_ENV', 'OTHER_KEY']) delete process.env[k];
}

console.log('failure classes');
async function expectCode(label, run, expectedCode, messageRe) {
  try {
    await run();
    check(label, 'no throw', expectedCode);
  } catch (error) {
    check(`${label} code`, error.code, expectedCode);
    check(`${label} name`, error.name, 'WebError');
    if (messageRe) checkMatch(`${label} message`, error.message, messageRe);
  }
}
{
  resetConfig();
  const { provider } = makeCtx({ credential: 'sk-test' });
  stubFetch(() => errResponse(401, { error: { message: 'No auth credentials found' } }));
  await expectCode('401', () => provider.search({ query: 'q' }), 'WEB_PROVIDER_CREDENTIAL_INVALID', /rejected the credential/);

  stubFetch(() => errResponse(402, { error: { message: 'Insufficient credits' } }));
  await expectCode('402', () => provider.search({ query: 'q' }), 'WEB_PROVIDER_QUOTA', /402/);

  stubFetch(() => errResponse(429, { error: 'slow down' }));
  await expectCode('429', () => provider.search({ query: 'q' }), 'WEB_PROVIDER_RATE_LIMITED', /429/);

  stubFetch(() => errResponse(400, { error: { message: 'engine not supported' } }));
  await expectCode('400', () => provider.search({ query: 'q' }), 'WEB_PROVIDER_ERROR', /engine not supported/);

  stubFetch(() => okResponse({ choices: [{ message: { role: 'assistant', content: '' } }] }));
  await expectCode('no answer, no citations', () => provider.search({ query: 'q' }), 'WEB_PROVIDER_ERROR', /neither an answer nor url_citation/);

  stubFetch(() => { throw new TypeError('fetch failed', { cause: new Error('getaddrinfo ENOTFOUND openrouter.ai') }); });
  await expectCode('network failure', () => provider.search({ query: 'q' }), 'WEB_PROVIDER_ERROR', /ENOTFOUND/);

  const empty = makeCtx();
  stubFetch(() => okResponse(CANNED));
  await expectCode('missing credential', () => empty.provider.search({ query: 'q' }), 'WEB_PROVIDER_CREDENTIAL_MISSING', /no credential/);

  const { provider: p2 } = makeCtx({ credential: 'sk-test' });
  stubFetch(() => okResponse(CANNED));
  const controller = new AbortController();
  controller.abort(new Error('caller gave up'));
  await expectCode('aborted before dispatch', () => p2.search({ query: 'q' }, controller.signal), 'WEB_ABORTED', /caller gave up/);
}

console.log('content-part response shape');
{
  resetConfig();
  const { provider } = makeCtx({ credential: 'sk-test' });
  stubFetch(() => okResponse({ choices: [{ message: { content: [{ type: 'text', text: 'part one ' }, { type: 'text', text: 'part two' }] } }] }));
  const result = await provider.search({ query: 'q' });
  check('parts joined', result.content, 'part one part two');
}

console.log(`\n${fail === 0 ? 'PASS' : 'FAIL'}  passed=${pass} failed=${fail}`);
process.exit(fail === 0 ? 0 : 1);
