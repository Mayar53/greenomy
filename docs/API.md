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
| POST | /ai/assistant | user | `{ message, lang? }` → `{ reply, sources, answeredBy }` — answered from Greenomy's own content plus the member's plants |

Both are rate-limited (40 per 15 min) because every call costs money at the
provider. Without a key, `identify` returns **503**; the assistant does not —
see below.

The assistant does not answer from the model's general memory. Each request
retrieves the relevant **Green Hub articles** (keyword/synonym matching over
title, description, body and translations — no vector store), the catalog facts
for any plant the question names, the member's own plants and their local
conditions, and puts them in front of the model as **CONTEXT**. `sources` lists
the slugs of the guides that grounded the answer. When the CONTEXT doesn't cover
the question, the model says so instead of inventing an answer. To teach it
something new, add a Green Hub article — no code change needed.

If the model is unavailable — no key, a spent daily quota, an outage — the
backend answers from the retrieved guide itself and reports `answeredBy: "guide"`
rather than `"ai"`, so the feature still works. `lang` (`en`/`ar`/`ku`) picks
which translation that answer is drawn from.

## Recommendations
| Method | Path | Auth | Notes |
|---|---|---|---|
| GET | /recommendations | user | `?duration=weeks\|months\|season\|any` and `?space=indoor\|outdoor\|both` → `{ conditions, appliedPreference, recommendations }` |
| GET | /catalog | – | the plant catalog the recommendations are drawn from |

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
| PATCH /users/me | user | `{ fullName?, city? }` |
| GET /users/me/impact | user | plants grown, verified photos, est. CO₂ |

## Plants
| GET /plants | user | current user's plants |
| POST /plants | user | `{ plantType, plantingMethod?, plantingDate?, location? }` |
| GET /plants/:id | user | |
| PATCH /plants/:id | user | |
| DELETE /plants/:id | user | |

## Verifications
| POST /verifications | user | `{ plantId, imageUrl, gpsLat?, gpsLong? }` — scored by the verification provider; ≥85% confidence auto-approves and awards points, otherwise queued as `pending` |
| GET /verifications/:id | user | |
| GET /verifications/history | user | |

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
