[English](README.md) · [Русский](README.ru.md)

# OpenRouter Web Search

Answers the harness's built-in `web_search` tool through OpenRouter's
[web-search server tool](https://openrouter.ai/docs/guides/features/server-tools/web-search), pinned to
the **Parallel** engine.

One `web_search` call becomes one OpenRouter Chat Completions request carrying
`tools: [{ type: "openrouter:web_search", parameters: { engine: "parallel", mode, max_results, search_context_size } }]`.
OpenRouter runs the search server-side and returns a grounded answer in `choices[0].message.content`
plus standardized `url_citation` annotations. The provider maps both onto the seam's
`WebSearchResult`, so the shipped tool renders the answer and its sources with no tool changes.

## Install

Clone the repository anywhere on disk:

```
git clone https://github.com/nightfun-pixel/dsh-OpenRouter-search.git
```

Point the harness's plugin manager at the **absolute** path of the cloned directory —
`plugin_manager` with `action: install_bundle` and `target: <absolute path>`. The package is
installed as a `link:` entry in the active profile, so edits to the clone take effect on the next
launch.

Restart the harness after installing. The host half (the search provider and its `Config` schema)
mounts from the profile; the client half (the settings card) is a browser bundle the page picks up on
load.

## What the composition changed

`cordis.patch.yml` inserts the provider row and overrides the `web` row:

```yaml
- id: web
  name: '@deepseek-ai/dsh-web'
  config:
    searchProvider: openrouter
```

That override is required, not cosmetic. With two usable search providers registered and none
configured, the seam fails every `web_search` with `WEB_PROVIDER_AMBIGUOUS` instead of choosing one,
so registering the provider alone would break the capability it adds.

## No key handling

The provider resolves `OPENROUTER_API_KEY` through `ctx.credentials` — the same reference the
profile's `llm-pi-ai` row already uses for chat — and falls back to the launching process
environment. Nothing has to be typed in, and no secret is stored in this package.

## Settings

Settings → Plugins → **OpenRouter search**:

| Control | Values | Default |
| --- | --- | --- |
| Engine | `parallel` — fixed, shown for reference | `parallel` |
| Mode | `fast`, `advanced` | `fast` |
| Search context size | `low`, `medium`, `high` | `medium` |
| Results per search | 1–10 | `5` |

The same three fields are also on the row's own configure control, generated from the plugin's
`Config` schema; the card is the friendlier of the two surfaces.

A save writes an override into the profile's `cordis.patch.yml`; *Reset to default* clears it back to
the composition layer seeded by this bundle's patch. The settings namespace is the row id,
`openrouter-web-search`.

`max_results` sent to OpenRouter is the **lower** of the tool's own bound and the saved setting, so a
narrow tool call is never widened by a broad setting.

## Tests

`test/provider.test.mjs` runs the provider against a stubbed `ctx.web` and a stubbed global `fetch`:
no network, no credential, no profile state touched.

```
node plugins/openrouter-web-search/test/provider.test.mjs
```

## Tuning outside the settings page

This package imports nothing, so it exports no schemastery `Config` built by a library — the schema is
a hand-written native graph. Values the card does not own come from the environment that launched the
harness:

| Variable | Default | Meaning |
| --- | --- | --- |
| `DSH_OPENROUTER_SEARCH_MODEL` | `deepseek/deepseek-v4.1-flash` | Grounding model; must support tool calling. |
| `DSH_OPENROUTER_SEARCH_BASE_URL` | `https://openrouter.ai/api/v1` | API base; `/chat/completions` is appended. |
| `DSH_OPENROUTER_SEARCH_API_KEY_ENV` | `OPENROUTER_API_KEY` | Credential reference to resolve instead. |
| `DSH_OPENROUTER_SEARCH_TIMEOUT_MS` | `120000` | Wall-clock bound on one search. |

## Cost

OpenRouter bills the search separately from the model turn. Parallel `fast` is $1 per 1,000 requests,
`advanced` $5 per 1,000, each including up to 10 results; the grounding model's tokens are billed on
top. A measured search on `deepseek/deepseek-v4.1-flash` with `mode: fast` cost about $0.014.

## Failure classes

Failures carry the seam's open-string `code`; the message states the fix.

| Code | Cause |
| --- | --- |
| `WEB_PROVIDER_CREDENTIAL_MISSING` | Neither the credential store nor the environment holds the key. |
| `WEB_PROVIDER_CREDENTIAL_INVALID` | OpenRouter rejected the stored key (HTTP 401/403). |
| `WEB_PROVIDER_QUOTA` | No credits (HTTP 402); search is billed even for free models. |
| `WEB_PROVIDER_RATE_LIMITED` | HTTP 429; retrying shortly is safe. |
| `WEB_PROVIDER_TIMEOUT` | Exceeded `DSH_OPENROUTER_SEARCH_TIMEOUT_MS`. |
| `WEB_ABORTED` | The caller cancelled the search. |
| `WEB_PROVIDER_ERROR` | Anything else, naming the endpoint and model in use. |

Because this bundle imports nothing, its `WebError` is a local class rather than the seam's, so the
tool layer renders these as `Error: <message>` instead of attaching the code to structured error
metadata. The messages are written to stand alone for that reason.

## Switching back

The profile's own `cordis.patch.yml` is applied after every bundle layer, so it wins:

```yaml
- id: web
  name: '@deepseek-ai/dsh-web'
  config:
    searchProvider: deepseek-official
```

Removing this bundle also works. The shipped DeepSeek provider stays registered and untouched either
way.

## Why the schema is hand-written

A profile-installed bundle resolves bare specifiers from its own directory, which cannot see the dsh
installation's `node_modules`, so this package imports nothing at all — including no schema library.
`Config` is therefore a native Schemastery graph built by hand: `Symbol.for('schemastery') === true`,
a string `type`, an object `meta`, volatile field nodes, and a `toJSON()` that reproduces
Schemastery's `{ uid, refs }` serialization. Those are exactly the three things the host reads —
Cordis mounts through `Config['~standard']`, `dsh-app-boot` projects through the graph, and
`dsh-settings` rebuilds a real schema from `toJSON()`.
