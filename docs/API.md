# Greenomy REST API

Base URL (development): `http://localhost:4000/api`

All authenticated routes expect `Authorization: Bearer <jwt>`. The same API
serves this web app and, in the future, a Flutter/React Native mobile app —
nothing in these routes is web-specific.

## Auth
| Method | Path | Auth | Notes |
|---|---|---|---|
| POST | /auth/signup | – | `{ fullName, email, password, city? }` |
| POST | /auth/login | – | `{ email, password }` → `{ user, token }` |
| POST | /auth/logout | user | stateless JWT; discards client-side |
| POST | /auth/forgot-password | – | `{ email }` — always a generic response; emails a single-use reset link |
| POST | /auth/reset-password | – | `{ token, newPassword }` — token is single-use and valid for 30 minutes |
| POST | /auth/change-password | user | `{ currentPassword, newPassword }` |
| GET | /auth/me | user | current session's user |

## AI (optional — needs `AI_API_KEY`)
| Method | Path | Auth | Notes |
|---|---|---|---|
| POST | /ai/identify | user | `{ imageUrl }` → `{ plantType, confidence, alternatives }` |
| POST | /ai/assistant | user | `{ message, lang?, history? }` → `{ reply, sources, answeredBy, intent, language }` — answered from Greenomy's own content plus the member's plants. `history` (recent `{role, content}` turns, bounded server-side) continues a conversation; there is no message cap |

Both are rate-limited (a rolling 15-minute cap and a per-minute burst cap)
because every call costs money at the provider. This is cost protection, not a
question limit — a conversation may continue freely within it. Without a key,
`identify` returns **503**; the assistant does not — see below.

The assistant answers through an explicit pipeline: **language → entities
(plant and variety) → intent → retrieval → conditions → member context →
context builder → model**. Each request retrieves the relevant **Green Hub
articles** (keyword/synonym/stem matching over title, description, body and
translations — no vector store), the catalog facts and **sourced knowledge rows**
for any plant the question names (exact values, never the model's memory), the
member's own plants, and conditions **only when the question depends on them**.
`sources` lists the slugs of the guides that grounded the answer. To teach it
something new, add a Green Hub article — no code change needed.

Retrieved text and the member's message are treated as **untrusted data**: they
are delimited in the prompt and cannot override the system rules, so a guide (or
a message) cannot turn the assistant into anything else.

`lang` (`en`/`ar`/`ku`) is used when supplied; otherwise the language is detected
from the message, and the model is told to reply in that language and match the
member's dialect (Iraqi Arabic stays Iraqi Arabic, Kurdish stays Kurdish).

If the model is unavailable — no key, a spent daily quota, an outage — the
backend answers from the retrieved guide itself and reports `answeredBy: "guide"`
rather than `"ai"`, so the feature still works.

## Recommendations
| Method | Path | Auth | Notes |
|---|---|---|---|
| GET | /recommendations | user | `?duration=weeks\|months\|season\|any` and `?space=indoor\|outdoor\|both` → `{ conditions, appliedPreference, recommendations }` |

The recommendation catalog is served by `GET /catalog` (see **Catalog** above).

The ranking is **deterministic** (`services/recommendation.service.js`), scored
against climate, season, duration, stored preferences, experience and space.
No AI is involved, so a recommendation can never invent a plant, a season or a
harvest time. Two factors are hard filters (a plant that can't live in the space
they have, one that takes longer than they'll wait); the rest only affect order.

`conditions.source` is `open-meteo` or `climate-table` — the latter whenever the
live lookup is unavailable or the city isn't recognised, in which case
`conditions.approximate` is `true` and the request still succeeds.

## Development
| GET /dev/mail | – | development only — the outbox of emails the app would have sent (password-reset links). Not mounted when `NODE_ENV=production`. |

## Users
| GET /users/me | user |
| PATCH /users/me | user | `{ fullName?, city?, experience?, plantTypes?, interests? }` |
| GET /users/me/impact | user | plants grown, verified photos, est. CO₂ |

## Plants
| GET /plants | user | current user's plants |
| POST /plants | user | `{ canonicalPlantId }` **or** `{ plantType }` / `{ customName }`, plus `plantingMethod?`, `plantingDate?`, `location?`, `varietyId?`. A catalog plant also starts its growth journey |
| GET /plants/:id | user | |
| PATCH /plants/:id | user | |
| DELETE /plants/:id | user | |

## Catalog
| GET /catalog | – | active catalog rows |
| GET /catalog/search?q=&lang=&category=&limit= | – | alias-aware search: English, scientific, MSA, Iraqi and Kurdish names all resolve to one canonical plant |
| GET /catalog/:slug | – | one plant with its `varieties` and sourced `knowledge` |

## Journeys
| GET /journeys | user | the member's journeys, each with its milestones |
| POST /journeys | user | `{ plantId }` — starts (or returns) that plant's journey |
| GET /journeys/:id | user | |
| POST /journeys/:id/milestones/:milestoneId/complete | user | marks a milestone reached (idempotent) |

Milestone windows are computed from the plant's own germination period and
days-to-harvest — stage-based, not a fixed calendar.

## Verifications
| POST /verifications | user | multipart (`image` file, `plantId`, `challengeId?`, `milestoneId?`, `gpsLat?`, `gpsLong?`) or the legacy JSON `{ plantId, imageUrl, … }`. The server measures the real bytes |
| POST /verifications/challenge | user | `{ plantId? }` → `{ challengeId, code, expiresAt }` — a fresh code to show in the photo |
| GET /verifications/:id | user | |
| GET /verifications/:id/image | user | the stored **original** photo, owner only |
| GET /verifications/history | user | |

The decision uses several signals, not one model:

- **integrity** — sha256 plus perceptual hashes (aHash/dHash/pHash) and
  green/brightness/sharpness stats, all computed server-side from the bytes;
- **duplicates** — exact (sha256) and near (perceptual Hamming distance) matches
  against **every** user's submissions;
- **challenge** — a fresh, expiring, single-use code a reward-eligible
  (milestone) photo must show;
- **identity** — the expected plant, when a vision model is configured.

A plain photo auto-approves at ≥85% confidence. A duplicate, or a milestone
photo whose code could not be confirmed, is marked `requires_review` and queued
— never auto-declared fraud. `verification_result` records the signals so an
admin can see why. Points are awarded by the reward engine on approval, and the
award is idempotent.

## Admin verification queue
| GET /admin/verifications | admin | pending queue |
| POST /admin/verifications/:id/approve | admin | awards points |
| POST /admin/verifications/:id/reject | admin | `{ reason? }` |

## Rewards
| GET /rewards | – | active rewards |
| GET /rewards/:id | – | |
| POST /rewards/:id/redeem | user | checks points + expiry, deducts points, returns a one-time QR token |

## Wallet
| GET /wallet | user | current points, total earned/spent |
| GET /wallet/transactions | user | full ledger |

## Green Hub
| GET /green-hub?category= | – | |
| GET /green-hub/:slug | – | |

## Impact
| GET /impact | – | platform-wide counters for the homepage |

## Waitlist
| POST /waitlist | – | `{ fullName, email, city, gardeningInterests? }`, rate-limited |

## Partners
| GET /partners | – | active partners |
| POST /partners | admin | |
| PATCH /partners/:id | admin | |

## Notifications
| GET /notifications | user | |
| PATCH /notifications/:id/read | user | |

## Error shape
```json
{ "error": "Human-readable message" }
```
Validation and business-rule failures use 4xx status codes (400, 401, 402,
403, 404, 409, 410); unexpected failures return 500 with no internal detail
leaked to the client.
