# Panthorium Social Media design

This package preserves the product design requested on 15 October 2026 and is
being added to the repository on 16 October 2026 (Asia/Bangkok).

Open [Panthorium-Social-Design.html](Panthorium-Social-Design.html) locally in a
browser to explore the six windows and expand the embedded Thai architecture
document. The HTML is self-contained and needs no server, installation or login.

## Navigation and modules

All six windows belong to one expandable **Start Menu → Social Media** category,
with an icon per entry:

| Window | Proposed scope |
| --- | --- |
| Watch | Video sharing, creator channels, playlists and sharing clip timestamps |
| Community | Text/photo/video posts, groups and audience selection |
| Talk | Multimedia messages, voice calls and video calls |
| Market | Shops, products and seller conversations with product context |
| Live | Broadcasts, cohosts, questions and pinned products |
| Connect | Opt-in adult dating, mutual matching and accepted call invitations |

The proposal uses Panthorium Browser and the existing Google Cloud foundation.
It keeps personal, organizational, seller and dating contexts separate while
sharing account identity and permission-controlled media references. Connect
supports male/male, female/male and female/female relationships equally, along
with user-defined identity and preference options.

## Delivery status

This is **design and simulated interaction only**, not a production social
platform. Its persistent banner identifies mock data and disconnected services.
Posts, messages, call invitations, storefront interactions, live chat and matching
examples exist only in page memory and reset on reload. No requests are sent,
no camera or microphone is opened, and no payment or broadcast is performed.

Merging these files does not add a production Start Menu category or activate
chat, calls, live streaming, marketplace settlement or dating. Those capabilities
require the backend, media transport, authorization, age eligibility, moderation
and deployment work specified inside the architecture document.

`/design/social-media/` is excluded from the Docker build context so the mock
application is not served from the production frontend root. Download the HTML
from this repository and open it locally to review the design.

## Architecture specification

The embedded document covers the six windows and linked journeys, voice actions
and confirmation, microphone ownership, identity contexts, age-aware access,
messaging and call states, Google Cloud control/media planes, normalized data
models and API contracts, authorization revocation, media lifecycle, commerce,
moderation, cost controls, repository reuse/gaps and phased acceptance criteria.
The repository audit baseline is commit `5eab732`; official reference links and
the 15 October 2026 design date are retained in the document.

## Validation and provenance

- Imported from the previously delivered `Panthorium-Social-Design.html`.
- Original SHA-256: `9494a7d666ca63b038a5a1893f38579d55b778f885d2b3d2d74588051ff0f5f5`.
- The repository copy changes only one delivery-status sentence to explain that
  merging a design does not activate the product. Prototype behavior is unchanged.
- Chromium checks passed for all six views at 320, 390 and 1024 px, including
  posting, sharing to chat, call invitations, product inquiries, live chat,
  opt-in/mutual-interest/reset flows and the Social Media accordion.
- The integrated architecture document also fits those viewport widths.
- These checks validate the prototype only; they are not production social,
  payment, privacy or RTC end-to-end test results.
