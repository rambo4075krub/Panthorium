# Groq model migration

Groq retired `llama-3.1-8b-instant` for free/developer accounts on August 16,
2026. Panthorium's old default could therefore fail before falling back to OpenAI.
The production screenshot confirmed one Groq failure and one OpenAI success;
it did not expose Groq's HTTP error or the account tier.

The new default is Groq's recommended `openai/gpt-oss-20b`. The provider manager
also maps the old default from `GROQ_MODEL` or a saved client request to this ID,
so an existing Cloud Run environment setting does not pin the retired model.
Other explicitly configured model IDs are preserved. Client requests still must
resolve to the configured model; the migration does not allow arbitrary models.

Both completion and native streaming use `reasoning_effort=low`,
`include_reasoning=false`, and `max_completion_tokens=2048` for this Groq model.
The budget includes reasoning as well as the final answer. Only answer content
is returned to the chat/voice client. Groq streaming usage in `x_groq.usage` is
counted alongside OpenAI-style `usage` events.

`test/phase4-ai.js` runs the mocked provider regression in `test/provider-groq.js`,
covering an existing environment pin, saved model selection, normal/streaming
Thai output, token accounting, the model allowlist, and OpenAI fallback.
Mocks verify the request/response contract; production keys and quotas require
a live smoke test after deployment.

After deploying, check `/api/ai/providers` using the application's authenticated
session: Groq should show `openai/gpt-oss-20b`. Send a short test to Sentinel and
check the response provider and fallback count. The 24-hour dashboard includes
earlier failures; its totals need not reset when the model changes. A configured
key is not proof of a successful provider response.

Sources: [Groq retirement notice](https://console.groq.com/docs/deprecations),
[replacement model](https://console.groq.com/docs/model/openai/gpt-oss-20b),
[reasoning controls](https://console.groq.com/docs/reasoning),
[API reference](https://console.groq.com/docs/api-reference).
