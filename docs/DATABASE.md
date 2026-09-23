# Greenomy — Database Schema (PostgreSQL)

This is the **live** schema, not a target. It is created by
`backend/database/migrations/001_init.sql` and queried through
`backend/models/*.model.js`.

```
cd backend
npm run migrate   # applies database/migrations/*.sql (tracked in schema_migrations)
npm run seed      # admin account, partners, rewards, Green Hub articles
```

Point `DATABASE_URL` at a local Docker instance (`docker compose up -d db` at
the project root) or a managed provider (set `DATABASE_SSL=true`).

## Conventions
- Primary keys are `uuid` with `DEFAULT gen_random_uuid()` — **except
  `rewards.reward_id`**, which is `text` holding the stable `rw-001` ids from
  `rewards.json`. That keeps seeding idempotent and the existing frontend ids
  valid.
- User-owned rows cascade on user delete.
- `users.total_points` is a cached sum kept in sync by the backend inside the
  same transaction that writes `point_transactions`; the ledger remains the
  auditable record.

## users
| column | type | notes |
|---|---|---|
| user_id | uuid PK | |
| full_name | text | |
| email | text unique | login lookups |
| password_hash | text | bcrypt cost 12, never returned by the API |
| city | text | |
| total_points | integer default 0 | `CHECK (total_points >= 0)` |
| role | text | `user` \| `admin` \| `super_admin` |
| status | text | `active` \| `suspended` |
| created_at / updated_at | timestamptz | |

## plants
| column | type |
|---|---|
| plant_id | uuid PK |
| user_id | uuid FK → users |
| plant_type | text |
| **planting_method** | text |
| stage | text (`seed`/`sprout`/`plant`) |
| planting_date | timestamptz |
| **location** | text |
| last_watered / next_watering | timestamptz |
| status | text |
| created_at / updated_at | timestamptz |

## verifications
| column | type |
|---|---|
| verification_id | uuid PK |
| plant_id | uuid FK → plants |
| user_id | uuid FK → users |
| image_url | text (base64 data URL today) |
| gps_lat / gps_long | double precision |
| captured_at | timestamptz |
| ai_confidence_score | numeric(4,2) |
| **ai_provider** | text |
| **ai_metrics** | jsonb |
| approval_status | text (`pending`/`approved`/`rejected`) |
| admin_reviewed_by | uuid FK → users (nullable) |
| rejection_reason | text |
| created_at / reviewed_at | timestamptz |

GPS is stored for internal verification and aggregate stats only — never
exposed at full precision through a public API response.

## partners
| partner_id | uuid PK | name | text **unique** (makes seeding idempotent) | logo_url | website | description | contact_email | is_active | created_at |

## rewards
| column | type | notes |
|---|---|---|
| reward_id | **text PK** | the `rw-001` id from `rewards.json` |
| partner_id | uuid FK → partners | nullable |
| partner | text | denormalised display name returned by the API |
| category | text | `restaurant` \| `courses` \| `supplies` \| `university` |
| title / description | text | English base copy |
| image_url | text | |
| points_required | integer | |
| expires_at | timestamptz | |
| is_active | boolean | |
| i18n | jsonb | per-record AR/KU translations |
| created_at / updated_at | timestamptz | |

## redemptions
| redemption_id | uuid PK | user_id FK | reward_id FK → rewards | partner_id FK | points_spent | qr_code_hash (nullable) | redemption_token **unique** | is_used | expires_at | used_at | created_at |

`redemption_token` is the only thing encoded in the QR. It is opaque,
single-use and time-limited. Consumption is a conditional UPDATE
(`WHERE is_used = false AND expires_at > now()`), so two simultaneous scans
resolve to exactly one winner.

## point_transactions
| transaction_id | uuid PK | user_id FK | amount (signed) | transaction_type | description | reference_id | created_at |

Every points change — earned or spent — is written here inside the same
transaction as the `users.total_points` update.

## waitlist
| waitlist_id | uuid PK | full_name | email **unique** | city | gardening_interests | created_at |

The unique index is the authority; a duplicate is mapped to HTTP 409.

## green_hub_content
| column | type |
|---|---|
| content_id | uuid PK |
| slug | text **unique** |
| title | text |
| description | text |
| category | text (`food-seed-recycling`/`home-gardening`/`plant-care`) |
| content_type | text (`article`) |
| **body** | jsonb (array of paragraphs) |
| image_url / video_url | text |
| reading_time | integer |
| is_published | boolean |
| **i18n** | jsonb (per-record AR/KU translations) |
| created_at / updated_at | timestamptz |

## notifications
| notification_id | uuid PK | user_id FK | title | message | type (`watering`/`growth`/`reward`/`verification`) | is_read | created_at |

## password_resets
| reset_id | uuid PK | user_id FK → users | token_hash (SHA-256, **unique**) | expires_at | used_at | created_at |

Only the hash of a reset token is stored, so a database leak yields no working
links. Tokens are single-use and expire after 30 minutes; requesting a new link
supersedes any outstanding one.

## device_tokens
| token_id | uuid PK | user_id FK → users | token (**unique**) | platform (`web`/`ios`/`android`) | created_at | last_seen_at |

Push delivery targets these; re-registering a device refreshes its row.

## schema_migrations
Created by the migration runner: `filename text PK`, `applied_at timestamptz`.

---

### Indexing notes
- `users.email`, `waitlist.email`, `partners.name`, `green_hub_content.slug`,
  `redemptions.redemption_token` — unique indexes
- `plants.user_id`, `verifications.user_id`, `verifications.plant_id` — dashboard/history queries
- `verifications.approval_status` — the admin queue (`WHERE approval_status = 'pending'`)
- `rewards.category`, `green_hub_content.category` — store and Hub filters
