# Public API (`/api/v1`)

The public API lets you drive your wacrm instance from your own
scripts and automations — send messages, manage contacts, launch
broadcasts — without going through the dashboard UI.

> **Status:** building out. Authentication, scopes, rate limiting,
> the `GET /api/v1/me` probe, and **`POST /api/v1/messages`** ship
> now. The remaining data endpoints (`contacts`, `conversations`,
> `broadcasts`, …) land one at a time — see [Roadmap](#roadmap).

## Authentication

Every request authenticates with an **API key**, sent as a bearer
token:

```
Authorization: Bearer wacrm_live_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
```

Keys are **account-scoped**: a key acts on exactly one account, the
one it was created in. There is no cross-account access.

### Creating a key

In the dashboard: **Settings → API keys → New API key**. Only
**admins and owners** can create keys.

1. Give the key a name (after the integration that will use it).
2. Grant the **scopes** it needs — nothing more (see below).
3. Copy the key. **The full key is shown exactly once.** wacrm
   stores only a SHA-256 hash, so it can never be shown again. If you
   lose it, revoke it and create a new one.

### Revoking a key

**Settings → API keys → Revoke.** Revocation is effective on the
key's next request. Revoked keys stay in the list as an audit trail.

## Scopes

A key can do only what its scopes allow — independent of who created
it. Grant the minimum.

| Scope                | Allows                                   |
| -------------------- | ---------------------------------------- |
| `messages:send`      | Send WhatsApp messages                   |
| `messages:read`      | Read messages and delivery status        |
| `contacts:read`      | List and read contacts                   |
| `contacts:write`     | Create and update contacts               |
| `conversations:read` | List and read conversations              |
| `broadcasts:send`    | Launch broadcast campaigns               |

A key with **no scopes** still authenticates and can call
`GET /api/v1/me` — useful for verifying a key works.

## Response envelope

Every response uses one of two shapes:

```jsonc
// success
{ "data": { /* ... */ } }

// failure
{ "error": { "code": "forbidden", "message": "This API key is missing the 'messages:send' scope" } }
```

Branch on `error.code` (stable); `error.message` is for humans and
may be reworded.

| Status | `code`         | Meaning                                          |
| ------ | -------------- | ------------------------------------------------ |
| 401    | `unauthorized` | Missing / malformed / unknown / revoked / expired key |
| 403    | `forbidden`    | Valid key, but missing the required scope        |
| 429    | `rate_limited` | Per-key rate limit exceeded                      |
| 400    | `bad_request`  | Malformed input                                  |
| 404    | `not_found`    | No such resource                                 |
| 500    | `internal`     | Server error                                     |

## Rate limits

Requests are limited **per key**: **120 requests per minute**. On a
`429`, these headers tell you when to retry:

- `Retry-After` — seconds until the window resets
- `X-RateLimit-Limit`, `X-RateLimit-Remaining`, `X-RateLimit-Reset`

> The limiter is in-memory and **per process**. A single-instance
> deploy (the common case for a self-hosted fork) is fine as-is. If
> you scale to multiple instances, swap the limiter for a shared
> store (Redis/Upstash) — see the note at the top of
> `src/lib/rate-limit.ts`. The limit is otherwise unenforced across
> instances.

## Endpoints

### `GET /api/v1/me`

Returns the account a key is bound to and the scopes it carries.
Requires only a valid key (no scope). Use it to verify a key works
and to discover its scopes.

```bash
curl https://your-crm.example.com/api/v1/me \
  -H "Authorization: Bearer wacrm_live_xxx"
```

```json
{
  "data": {
    "account": { "id": "…", "name": "Acme Inc" },
    "key": { "id": "…", "scopes": ["messages:send"] }
  }
}
```

### `POST /api/v1/messages`

Send a WhatsApp message to a phone number. Scope: **`messages:send`**.

You send a **phone number**, not an internal id — the API finds the
matching contact (or creates one) and its conversation, then sends.

**Body**

| Field                 | Type             | Notes                                                        |
| --------------------- | ---------------- | ------------------------------------------------------------ |
| `to`                  | string, required | Recipient phone in E.164, e.g. `+14155550123`.               |
| `type`                | string           | `text` (default), `template`, `image`, `video`, `document`, `audio`. |
| `text`                | string           | Body for `text`; caption for media kinds (≤1024 chars).      |
| `media_url`           | string           | Public URL. Required for `image`/`video`/`document`/`audio`. |
| `filename`            | string           | Optional document filename shown to the recipient.           |
| `template`            | object           | Required for `type=template`: `{ name, language, params }`. `params` as an **array** = positional body variables; as an **object** = structured header/body/button params. |
| `reply_to_message_id` | string           | Optional. Must be a message in the same conversation.        |
| `name`                | string           | Optional. Names the contact if this call creates it.         |

> WhatsApp's 24-hour customer-service window applies: outside an open
> window, only approved **templates** are delivered. Send a `template`
> first to (re)open the window.

**Example**

```bash
curl -X POST https://your-crm.example.com/api/v1/messages \
  -H "Authorization: Bearer wacrm_live_xxx" \
  -H "Content-Type: application/json" \
  -d '{ "to": "+14155550123", "type": "text", "text": "Hi from the API 👋" }'
```

```json
{
  "data": {
    "message_id": "…",
    "whatsapp_message_id": "wamid.…",
    "conversation_id": "…",
    "contact_id": "…",
    "contact_created": true
  }
}
```

Common errors: `bad_request` (bad `to`/params), `whatsapp_not_configured`
(no WhatsApp connected), `meta_error` (Meta rejected the send, 502).

## Roadmap

Planned endpoints, shipping one per release (tracked in
[#245](https://github.com/ArnasDon/wacrm/issues/245)):

- ~~`POST /api/v1/messages` — send a message to a phone number~~ ✅ shipped
- `GET/POST /api/v1/contacts`, `GET/PATCH /api/v1/contacts/{id}`
  (`contacts:read` / `contacts:write`)
- `GET /api/v1/conversations` (`conversations:read`)
- `POST /api/v1/broadcasts` (`broadcasts:send`)
- Outbound event webhooks (so automations can react to inbound
  messages)
