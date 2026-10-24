# Free public information in Sentinel

Sentinel's typed chat, streamed chat and authenticated Gemini Live voice sessions
share three read-only tools. They use the existing chat permission, including
guests who already have that permission. They do not add a paid search, grounding,
transcription or weather subscription. Existing AI/voice and hosting costs still
apply; “free-only” describes external information retrieval.

| Tool | Source and coverage |
| --- | --- |
| `web.search` | DuckDuckGo Instant Answers plus Thai/English Wikipedia. Limited public-source search, **not** a full web/Google results index. Up to six source links/excerpts. No HTML SERP scraping. |
| `web.read` | Public HTTPS HTML, text and JSON, subject to robots.txt and access restrictions. No cookies, credentials, login, browser execution, paywall bypass or files/PDF. |
| `weather.get` | Wikipedia place coordinates and MET Norway Locationforecast. A forecast, not a current station observation. Place ambiguity is returned for clarification; unavailable dates are reported explicitly. |

Examples, typed or spoken:

- “ค้นข้อมูลกรุงเทพมหานครจากแหล่งฟรี พร้อมบอกแหล่งอ้างอิง”
- “อ่านและสรุป https://www.example.com/”
- “พรุ่งนี้กรุงเทพมหานครอากาศเป็นอย่างไร”

The model resolves relative dates using the existing current-time context and
passes an explicit local date to the weather tool. The default timezone is
Asia/Bangkok; another IANA timezone can be supplied for a requested location.
A date without returned forecast periods is unavailable, not invented.

## Free-only behavior

No provider keys, paid endpoint configuration or billing fallback exists in these
tools. Free-source failure returns `available:false`, a stable error and a Thai
message. HTTP 402, authentication/access restrictions, exhausted quotas, robots
restrictions, empty results, timeouts and unsupported content do not trigger paid
requests. A search miss means no result in the supported free sources, not that
information does not exist. Search can return partial results and source failures.

The service sends only the requested public query/place/URL. It never forwards
account tokens, cookies, user headers or credentials. Signed/key-bearing URL
parameters are rejected. Content is passed as explicitly untrusted evidence, with
source URLs and retrieval timestamps. Chat and voice instructions require source
attribution and prohibit following instructions embedded in source content.
These instructions reduce prompt-injection risk; they are not a guarantee about
all model behavior. Existing mutation/approval controls remain enforced.

## Limits and security

- GET over HTTPS/443 only; reject userinfo, IP literals and local hostnames.
- Validate every DNS answer, reject non-public ranges, and pin the selected IP to
  the actual connection while retaining TLS hostname verification.
- Revalidate every page redirect and its destination's robots policy. API redirects
  stay on the original free provider origin. No automatic cookie/auth forwarding.
- Bound DNS/network time, 20-second tool deadline, eight upstream requests,
  redirects, compressed/decompressed response bytes (512 KiB), and extracted text.
- Honor robots.txt, Crawl-delay and explicit no-AI/no-snippet restrictions. Unknown
  robots policy fails closed. Detected subscription/login gates return no content.
  Detection cannot perfectly classify every website; no authenticated access or
  JavaScript execution is attempted.
- Per process: four active tools, 60 calls/minute total, 12 calls/minute per user,
  one in-flight request per host with a cooldown, bounded response cache and
  duplicate-request coalescing. Honor provider Expires/Last-Modified and Retry-After.
  Cache and rate state are in memory, not distributed: monitor aggregate traffic
  across replicas before scaling (MET requires agreement above 20 requests/second
  per application). Provider quotas/outages can further restrict availability.

Enabled by default. `PANTHORIUM_PUBLIC_WEB_ENABLED=false` is a server-side kill
switch; it returns unavailable without making external requests. No UI setting or
model argument can enable paid fallback.

## Provider references

- Wikimedia API: https://www.mediawiki.org/wiki/API:Search
- Wikimedia access etiquette: https://www.mediawiki.org/wiki/API:Etiquette
- Wikipedia text attribution: https://creativecommons.org/licenses/by-sa/4.0/
- DuckDuckGo public JSON endpoint: https://api.duckduckgo.com/?q=Bangkok&format=json&no_html=1
- MET service terms: https://api.met.no/doc/TermsOfService
- MET licensing: https://api.met.no/doc/License
- Weather attribution: Data from MET Norway, CC BY 4.0,
  https://creativecommons.org/licenses/by/4.0/; results select/summarize forecast
  periods and carry the original data URL, update time and retrieval time.

## Validation

`node test/public-web.js` covers network boundaries, DNS pinning, compressed size
limits, caching, quotas, paywalls, robots, source metadata and weather resolution.
`node test/public-web-function-calling.js` exercises the real tool registry,
permission validation, streaming chat and authenticated live voice tool round trips
without calling a paid model. These run in `npm test`.

`PANTHORIUM_TEST_PUBLIC_WEB_LIVE=1 node test/public-web-live.js` is an opt-in smoke
against the actual free endpoints using the production transport. CI runs it as an
advisory check, since third-party outages must be represented as unavailable at
runtime rather than require a paid fallback. It makes no AI request.
