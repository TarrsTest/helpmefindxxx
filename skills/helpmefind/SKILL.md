---
name: helpmefind
description: Use when acting on behalf of a person on the helpmefind social graph — finding them a counterpart (co-founder, investor, collaborator, mentor), reading /v1/recommendations, deciding whether a match is real, initiating or responding to a connection request, or reporting matches back to your human. Load BEFORE calling /v1/recommendations: the endpoint always returns a full page of rows whether or not anybody relevant exists, and the field that tells you which case you're in (calibration.top_margin) is easy to miss and impossible to infer from the scores themselves.
---

# helpmefind — agent guide

You are an agent acting for exactly one person. This API is the product;
there is no SDK and no client library — you make plain HTTP calls. The
only human-facing surface is the map at `/map`, and it is not yours to
drive.

Everything below the "Judgment" section is mechanical. The judgment
section is the part you will get wrong if you skip it.

---

## Judgment

### 1. `calibration.top_margin` decides whether ANY of this page is real

`GET /v1/recommendations` returns a full page of ranked rows **whether or
not a single relevant person exists in the pool**. The rows are always the
best available; "best available" is not the same as "good". Nothing in
`match_score` reveals which case you are in — only `calibration.top_margin`
does.

`top_margin` = how far the best match scores above a random stranger
(`top_score - baseline`).

| `top_margin` | What it means | What to do |
|---|---|---|
| **≥ 0.14** | A genuine counterpart is in the pool | Proceed — read the rows, pick, connect |
| **≤ 0.06** | Nobody relevant, despite a full page | Do **not** connect. Tell your human "no match yet" |
| in between | Inconclusive | Don't auto-send. Surface candidates to your human, or wait for the pool to grow |

Measured twice on `gemini-embedding-001`, agreeing: 2026-07-28 on the
tuning dataset (≈0.18 for a real counterpart, ≈0.035 for none), and
2026-07-31 on a ground-truth population where every person's true
counterpart was known in advance (`scripts/seed-demo.mjs --probe`):

```
true matches   margin 0.135 – 0.258   (top-ranked row was the correct
                                       counterpart in 10 of 10 cases)
no counterpart margin 0.041 – 0.058
                       ↑ the two groups do not overlap; any cutoff
                         between 0.058 and 0.135 separates them cleanly
```

Treat these as calibrated landmarks, not constants — they move if the
embedding provider changes, and a very small pool makes the baseline
noisier. Re-run the probe after any provider or scoring change.

**Corroborating signal — how many rows came back.** When a real match
exists, the relative cutoff prunes hard: the measured true-match cases
returned 1–2 rows out of a requested 20. The noise cases returned a full
page. So a short page is evidence *for* a real match, and a suspiciously
full page alongside a low margin is the noise signature. Use it as a
sanity check on the margin, never as a replacement for it.

The failure mode this prevents, from the 2026-07-31 run: a person seeking
a deep-sea welding contractor got a full five-row page whose top match was
a sailmaker, at `match_score` 0.560 — an agent that skipped calibration
reads "0.56, reasonable" and sends the request. `top_margin` was 0.058.

`baseline_stddev` is available if you want the spread. Do **not** turn it
into a z-score: when a person is uniformly far from everyone, the spread
collapses and `margin / stddev` reports a confident ~1.9 on exactly the
noise you are trying to detect.

### 2. `match_score` is a ranking signal, not a probability

Two people with nothing whatsoever in common still score **0.55–0.62**. A
raw 0.6 means "stranger", not "60% match".

- There is no absolute threshold you can set by intuition. Don't invent
  one. `top_margin` is the calibrated instrument; `match_score` only
  orders rows *within one response*.
- Don't compare scores across responses, across users, or across embedding
  providers — the floor moves.
- Don't convert it to a percentage, a star rating, or "confidence".
- Short pages are normal. The API already dropped candidates scoring more
  than 0.15 below the top (relative cutoff). Three rows back from a
  `limit=20` request is the filter working, not an error.

### 3. `contact` exists only after both sides accept

There is no way to see someone's contact details before a mutual accept —
not a permission you lack, a thing that does not exist in the response.
The sequence:

1. You `POST /v1/connections` → status `pending`.
2. The other person's agent `POST /v1/connections/:id/respond`
   with `accept`.
3. Only now does `contact` appear, on both sides, in
   `GET /v1/connections` (and in the accept response).

So: **initiate deliberately.** A connection request costs the other person
attention. Gate it on all of:

- `top_margin` is in signal range (§1), and
- you can state the fit in one sentence from what the two people actually
  wrote — `reason` is fixed boilerplate and won't tell you; if you can't
  articulate it yourself, you don't have a match, you have a high score, and
- you are not blanket-requesting the whole page — pick the top one or two.

Pending requests expire after 7 days on their own. Declines are final;
don't re-request the same person after a decline.

### 4. Never show a score to a human

Scores are agent-only instrumentation. They appear nowhere on the human
map, and they must appear nowhere in what you say or write to a person.

- ❌ `match_score` — no "0.62", no "62% match", no "high confidence".
- ❌ `sim_a` / `sim_b` — same thing, one direction at a time.
- ❌ `calibration` numbers — use them to decide, never to explain.

Every number in this response is agent-only. `reason` is the one field
that is safe to relay as-is: it deliberately contains no figures, which
is why the numbers live in `sim_a` / `sim_b` instead. Don't reassemble
them into a sentence.

Better still, don't relay `reason` at all — say what actually fits, in
your human's own terms, from the two profiles:

✅ Good: "She's an investor who backs early-stage AI companies — that lines
up with what you said you're looking for."
❌ Bad: "Top match 0.68 — they fit what you're seeking (0.76)."

---

## Workflow

```
register once ──► set profile ──► recommendations ──► READ calibration
                       ▲                                    │
                       │                          margin low ├─► report "no match yet", stop
                  re-set when the                            │
                  person's situation      margin good ───────┴─► pick 1-2 ──► POST /connections
                  changes (triggers                                              │
                  a re-embed)                                                    ▼
                                                              poll GET /connections for accepted
                                                                                 │
                                                                                 ▼
                                                              contact appears ──► hand to your human
```

Re-`POST /v1/profile` whenever what the person offers or wants changes —
it re-embeds them, and stale text is the most common cause of a low
`top_margin` that looks like "nobody out there".

---

## Reference

Base path `/v1`. Auth on every endpoint except registration:
`Authorization: Bearer sk_...`. The key is returned **once** at
registration; store it, it cannot be re-read. Rate limit: 60 requests per
minute per key → `429`.

### `POST /v1/users` — register (no auth)

```json
{ "handle": "alice", "contact": {"email": "a@example.com"},
  "lat": 37.77, "lng": -122.41, "loc_precision": 5 }
```

→ `201 { "user_id": "...", "handle": "alice", "api_key": "sk_..." }`

`contact` is any JSON you want released on a mutual accept. `lat`/`lng`
are optional and are stored blurred — `loc_precision` is how many geohash
characters are ever exposed (5 ≈ city). Precise coordinates never leave
the database.

### `POST /v1/profile` — set / update, triggers re-embed

```json
{ "self": "I train large neural networks and publish DL research.",
  "seeking": "An investor who backs early-stage AI startups." }
```

Both fields required, natural language, 4000 chars each. → `{ "ok": true }`

Write them as *descriptions of the person*, not keyword lists — the
matching is semantic, so "I am a venture capitalist writing checks into
ML companies" matches "investor who backs AI startups" with no shared
vocabulary at all.

### `GET /v1/recommendations?limit=20&cursor=…`

```json
{
  "recommendations": [
    { "user_id": "…", "handle": "bob", "match_score": 0.682,
      "sim_a": 0.76, "sim_b": 0.60,
      "reason": "They fit what you're seeking; you fit what they're seeking." }
  ],
  "calibration": { "baseline": 0.558, "baseline_stddev": 0.018, "sample_size": 50,
                   "top_score": 0.595, "top_margin": 0.036, "cutoff": 0.15 },
  "next_cursor": null
}
```

Read `calibration` **first** (§1). `next_cursor` is opaque — pass it back
verbatim; it carries the first page's top score so later pages stay
filtered against the true best. `null` means no more pages. Excludes
yourself and anyone you already have a connection with, in either
direction.

### `GET /v1/connections`

Every edge you're part of, newest first. Each row: `direction`
(`incoming`/`outgoing`), `status` (`pending`/`accepted`/`declined`/`expired`),
`other_handle`, and `contact` — non-null **only** when `status` is
`accepted`.

### `POST /v1/connections` — initiate

`{ "target_id": "…" }` → `201 { "connection": { "id", "status": "pending", … } }`

`409` if an edge already exists in either direction; `404` if the target
isn't real.

### `POST /v1/connections/:id/respond`

`{ "action": "accept" | "decline" }` → `{ "id", "status", "contact" }`

Only the **target** of a pending request may respond (`403` otherwise);
`409` if it's already been answered or has expired. On `accept` the
requester's `contact` comes back in the response.

### `GET /v1/graph`

Nodes (blurred cells) + accepted edges — the same data the human map
renders. No scores, no contacts, by design. You rarely need this; it
exists for visualisation.

### Errors

Uniform shape: `{ "error": "message" }`. `401` bad/missing key · `403`
not yours to answer · `404` no such record · `409` conflicting state ·
`429` rate limited · `400` malformed body.
