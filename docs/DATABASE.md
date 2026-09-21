# Greenomy — Database Schema (PostgreSQL)

This documents the target schema. The current backend runs against an
in-memory mock store (`backend/database/mock-data.js`) so the API is
testable before PostgreSQL is provisioned; swap it out by implementing
`backend/models/*.model.js` with real `pg` queries against these tables.

## users
| column | type | notes |
|---|---|---|
| user_id | uuid PK | |
| full_name | text | |
| email | text unique | |
| password_hash | text | bcrypt, never returned by the API |
| city | text | |
| total_points | integer default 0 | authoritative balance, backend-only writes |
| role | text | `user` \| `admin` \| `super_admin` |
| status | text | `active` \| `suspended` |
| created_at / updated_at | timestamptz | |

## plants
| plant_id PK | user_id FK → users | plant_type | stage (`seed`/`sprout`/`plant`) | planting_date | last_watered | next_watering | status | created_at / updated_at |

## verifications
| verification_id PK | plant_id FK | user_id FK | image_url | gps_lat | gps_long | captured_at | ai_confidence_score | approval_status (`pending`/`approved`/`rejected`) | admin_reviewed_by | rejection_reason | created_at | reviewed_at |

GPS coordinates are stored for internal verification and aggregate
environmental stats only — never exposed at full precision through any
public API response.

## partners
| partner_id PK | name | logo_url | website | description | contact_email | is_active | created_at |

## rewards
| reward_id PK | partner_id FK | title | description | image_url | points_required | expires_at | is_active | created_at / updated_at |

## redemptions
| redemption_id PK | user_id FK | reward_id FK | partner_id FK | points_spent | qr_code_hash | redemption_token | is_used | expires_at | created_at | used_at |

`redemption_token` is the only thing encoded in the QR code. It is opaque,
single-use, and time-limited — no personal data is embedded in the QR.

## point_transactions
| transaction_id PK | user_id FK | amount (signed) | transaction_type | description | reference_id | created_at |

Every points change — earned or spent — is written here. `users.total_points`
is a cached sum that the backend keeps in sync; it is never trusted as the
sole source of truth for auditing.

## waitlist
| waitlist_id PK | full_name | email | city | gardening_interests | created_at |

## green_hub_content
| content_id PK | title | slug unique | description | category | content_type | body | image_url | video_url | reading_time | is_published | created_at / updated_at |

## notifications
| notification_id PK | user_id FK | title | message | type (`watering`/`growth`/`reward`/`verification`) | is_read | created_at |

---

### Indexing notes
- `users.email` — unique index (login lookups)
- `plants.user_id`, `verifications.user_id`, `verifications.plant_id` — for dashboard/history queries
- `verifications.approval_status` — for the admin queue (`WHERE approval_status = 'pending'`)
- `redemptions.redemption_token` — unique index (QR scan lookups)
- `green_hub_content.slug` — unique index
