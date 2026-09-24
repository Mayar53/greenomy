# Greenomy — Database Schema (PostgreSQL)

This is the **live** schema, not a target. It is created by
`backend/database/migrations/*.sql` (001–008) and queried through
`backend/models/*.model.js`.

```
cd backend
npm run migrate   # applies database/migrations/*.sql (tracked in schema_migrations)
npm run seed      # admin, partners, rewards, Green Hub, plant catalog, aliases,
                  # varieties, knowledge, stage templates — then links existing plants
```

Point `DATABASE_URL` at a local Docker instance (`docker compose up -d db` at
the project root) or a managed provider (set `DATABASE_SSL=true`).

## Conventions
- Primary keys are `uuid` with `DEFAULT gen_random_uuid()` — **except**
  `rewards.reward_id` (text, the stable `rw-001` ids) and `plant_catalog.id`
  (text, e.g. `pl-tomato`), both so seeding stays idempotent.
- User-owned rows cascade on user delete.
- `users.total_points` is a cached sum kept in sync by the backend inside the
  same transaction that writes `point_transactions`; the ledger remains the
  auditable record.
- Structured reference facts carry a **source** (`knowledge_sources`) — the
  database, not the model, is the source of truth for exact values.

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
| experience | text nullable | `beginner` \| `some-experience` \| `experienced` \| `expert` |
| plant_types | text[] | preferred categories |
| interests | text[] | sustainability interests from onboarding |
| created_at / updated_at | timestamptz | |

## plants
| column | type |
|---|---|
| plant_id | uuid PK |
| user_id | uuid FK → users |
| plant_type | text (display name) |
| planting_method | text |
| stage | text (`seed`/`sprout`/`plant`) |
| planting_date | timestamptz |
| location | text |
| last_watered / next_watering | timestamptz |
| status | text |
| **canonical_plant_id** | text FK → plant_catalog (nullable) |
| **variety_id** | uuid FK → plant_varieties (nullable) |
| **custom_name** | text (a plant outside the catalog) |
| created_at / updated_at | timestamptz |

`canonical_plant_id` is filled by the seeder's idempotent backfill
(`normalizeExistingPlants`): a free-text `plant_type` is resolved through the
alias table and linked, **without** deleting or merging the member's row. An
unresolvable name simply stays unlinked.

## plant_catalog
The canonical catalog — **one row per plant**. Every other spelling is an alias.

| column | type | notes |
|---|---|---|
| id | text PK | e.g. `pl-tomato` |
| name / slug | text / text unique | |
| scientific_name / accepted_name / family | text | taxonomy (Kew POWO) |
| category | text CHECK | `vegetables` / `herbs` / `fruit-trees` / `houseplants` |
| emoji | text | |
| days_to_harvest / growth_duration_days | integer | |
| germination_duration_days | integer | journey scheduling |
| temp_min_c / temp_max_c | numeric(5,1) | |
| soil_preferences / soil_ph_min / soil_ph_max | text / numeric(3,1) | |
| water / water_preferences | text CHECK / text | |
| sun / sunlight_preferences | text CHECK / text | |
| planting_season / harvest_window | text | |
| climates | text[] | zones it suits |
| planting_months | int[] | northern-hemisphere; **empty = any month** |
| seed_available | boolean | |
| stage_template | text | which `plant_growth_stages` template to use |
| notes / description | text | |
| i18n | jsonb | `ar` / `ku` name + notes |
| is_active | boolean | |
| created_at / updated_at | timestamptz | |

## plant_aliases
Every name a plant answers to, folded to one canonical row.

| column | type | notes |
|---|---|---|
| alias_id | uuid PK | |
| plant_id | text FK → plant_catalog | |
| language | text | `en` / `ar` / `ku` |
| alias | text | the name as written |
| normalized_alias | text | lowercased, letter-unified, article-stripped |
| source | text | e.g. `powo`, `greenomy` |
| **UNIQUE (normalized_alias, language)** | | an alias resolves to exactly one plant |

`tomato`, `tomatoes`, `طماطم`, `طماطة`, `بندورة`, `تەماتە` and
`Solanum lycopersicum` are all rows here pointing at `pl-tomato`.

## plant_varieties
| column | type |
|---|---|
| variety_id | uuid PK |
| plant_id | text FK → plant_catalog |
| name | text (UNIQUE per plant) |
| description / special_requirements | text |
| growth_duration_days | integer |
| i18n | jsonb |
| created_at / updated_at | timestamptz |

## knowledge_sources
Provenance for every structured fact.

| column | type |
|---|---|
| source_id | text PK (e.g. `powo`, `ecocrop`, `fao-calendar`, `greenomy`) |
| name / url / organization / type | text |
| accessed_at | date |
| created_at | timestamptz |

## plant_knowledge
| column | type | notes |
|---|---|---|
| knowledge_id | uuid PK | |
| plant_id | text FK → plant_catalog | |
| knowledge_type | text | e.g. `germination_duration_days`, `temperature_range`, `soil_ph_range` |
| value | jsonb | scalar or `{min,max}` |
| unit | text | |
| source_id | text FK → knowledge_sources (**NOT NULL**, default `greenomy`) | |
| confidence | numeric(3,2) | |
| updated_at | timestamptz | |
| **UNIQUE (plant_id, knowledge_type, source_id)** | | makes re-seeding idempotent |

The assistant is instructed to answer exact values **only** from here (and from
the catalog columns), never from its own memory.

## plant_growth_stages
The stages a journey walks through. `plant_id` NULL = a template row.

| column | type | notes |
|---|---|---|
| stage_id | uuid PK | |
| plant_id | text FK → plant_catalog (nullable) | NULL = template |
| template | text | e.g. `annual-vegetable`, `fruit-tree`, `houseplant` |
| stage_key | text | `planting`, `germination`, `flowering`, `harvest`, … |
| label_en / label_ar / label_ku | text | |
| sort_order | integer | |
| expected_day_from / expected_day_to | integer | set per journey, not per template |
| description | text | |

Unique index on `(template, stage_key, COALESCE(plant_id,''))`.

## journeys
| column | type | notes |
|---|---|---|
| journey_id | uuid PK | |
| user_plant_id | uuid FK → plants | **UNIQUE** — one journey per plant |
| user_id | uuid FK → users | |
| started_at | timestamptz | |
| expected_duration_days | integer | the plant's days-to-harvest |
| current_stage | text | furthest milestone reached |
| status | text | `active` / `completed` / `abandoned` |
| completed_at | timestamptz | |
| created_at / updated_at | timestamptz | |

## journey_milestones
| column | type | notes |
|---|---|---|
| milestone_id | uuid PK | |
| journey_id | uuid FK → journeys | UNIQUE (journey_id, stage_key) |
| stage_key / label_en / sort_order | text / text / integer | |
| expected_day_from / expected_day_to | integer | interpolated from germination → harvest |
| recommended_window | text | e.g. `Days 7–20` |
| completed_at | timestamptz | |
| verification_status | text | `none` / `pending` / `verified` / `rejected` |
| verification_id | uuid FK → verifications | evidence |
| created_at | timestamptz | |

## verifications
| column | type | notes |
|---|---|---|
| verification_id | uuid PK | |
| plant_id | uuid FK → plants | |
| user_id | uuid FK → users | |
| image_url | text | **bounded JPEG preview** (data URL); the original is on disk |
| **storage_path** | text | content-addressed filename (`<sha256>.<ext>`) |
| **image_sha256** | text | identity hash of the bytes |
| gps_lat / gps_long | double precision | internal only |
| captured_at | timestamptz | |
| ai_confidence_score | numeric(4,2) | |
| ai_provider | text | `heuristic` \| `ai` \| `mock` |
| ai_metrics | jsonb | |
| approval_status | text | `pending` / `approved` / `rejected` |
| **challenge_id** | uuid FK → verification_challenges | the code shown in the photo |
| **milestone_id** | uuid FK → journey_milestones | what this photo is evidence for |
| **duplicate_status** | text | `none` / `exact` / `near` / `review` |
| **requires_review** | boolean | flagged for a human |
| **verification_result** | jsonb | `{plantMatch, challengePassed, duplicate, crossUser, journeyConsistency, suspicious, requiresReview, confidence, …}` |
| admin_reviewed_by / rejection_reason | uuid / text | |
| created_at / reviewed_at | timestamptz | |

## verification_challenges
Per-attempt codes. A reward-eligible (milestone) photo must show one.

| column | type | notes |
|---|---|---|
| challenge_id | uuid PK | |
| user_id | uuid FK → users | |
| plant_id | uuid FK → plants (nullable) | |
| code | text | fresh random digits per attempt |
| issued_at / expires_at | timestamptz | short-lived |
| used_at | timestamptz | single use (conditional UPDATE) |

## verification_images
The hash record for every submitted image — the duplicate-detection corpus.

| column | type | notes |
|---|---|---|
| image_id | uuid PK | |
| verification_id | uuid FK → verifications (nullable) | linked after creation |
| user_id | uuid FK → users | |
| sha256 | text (indexed, **not unique**) | exact-identity; duplicates are recorded, not rejected |
| phash / dhash / ahash | text | 64-bit perceptual hashes, hex |
| width / height / bytes / mime | integer / text | |
| storage_path | text | |
| created_at | timestamptz | |

Duplicate detection reads this table **across all users**, so re-uploading
someone else's photo is caught too.

## reward_awards
The idempotency ledger for points: what has already been paid.

| column | type | notes |
|---|---|---|
| award_id | uuid PK | |
| user_id | uuid FK → users | |
| journey_id / milestone_id | uuid FKs (nullable) | |
| award_type | text CHECK | `photo_verified` \| `milestone_planting` \| `milestone_growth` \| `journey_completed` |
| points | integer CHECK > 0 | |
| reference_id | text **NOT NULL** | verification / milestone / journey id |
| created_at | timestamptz | |
| **UNIQUE (user_id, award_type, reference_id)** | | a replayed approval pays nothing |

## partners / rewards / redemptions / point_transactions / waitlist
Unchanged from the original schema. `rewards.reward_id` is text (`rw-001`);
`redemption_token` is single-use and opaque; `point_transactions` is the signed
ledger.

## green_hub_content / notifications / password_resets / device_tokens
Unchanged. See migrations 001–003.

## schema_migrations
`filename text PK`, `applied_at timestamptz`.

---

### Indexing notes
- Unique: `users.email`, `waitlist.email`, `partners.name`,
  `green_hub_content.slug`, `redemptions.redemption_token`,
  `plant_catalog.slug`, `plant_aliases(normalized_alias, language)`,
  `plant_knowledge(plant_id, knowledge_type, source_id)`,
  `journeys.user_plant_id`, `journey_milestones(journey_id, stage_key)`,
  `reward_awards(user_id, award_type, reference_id)`
- Lookup: `plants.user_id`, `plants.canonical_plant_id`, `verifications.user_id`,
  `verifications.plant_id`, `verifications.approval_status`,
  `verifications.image_sha256`, `verifications.requires_review`,
  `verification_images.sha256`, `verification_images.user_id`,
  `journeys.user_id`, `journey_milestones.journey_id`,
  `reward_awards.user_id`, `reward_awards.journey_id`
