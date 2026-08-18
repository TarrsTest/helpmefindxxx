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

**These numbers are calibrated for a pool of ~138 people.** Read the next
subsection before trusting them on a pool of a different size.

| `top_margin` | What it means | What to do |
|---|---|---|
| **≥ 0.13** | A genuine counterpart is in the pool | Proceed — read the rows, pick, connect |
| **≤ 0.09** | Nobody relevant, despite a full page | Do **not** connect. Tell your human "no match yet" |
| in between | Inconclusive | Don't auto-send. Surface candidates to your human, or wait for the pool to grow |

Do not confuse this threshold with `MATCH_RELATIVE_CUTOFF` (currently
`0.10`). They are different quantities that happen to sit near each other:

- **`top_margin` threshold** — *is this page worth reading at all?*
  Measured against a **random stranger** (`top_score - baseline`).
- **`MATCH_RELATIVE_CUTOFF`** — *how many rows survive on this page?*
  Measured against **this page's own top row**; the server drops anything
  scoring more than the cutoff below it.

One decides whether to look, the other decides how much comes back. They
are tuned independently — never reuse one's value for the other.

#### The threshold is a function of pool size

`baseline` is the score against a random stranger, and it **falls as the
pool grows** (more strangers → a lower average). Every margin is measured
from that baseline, so a growing pool pushes signal *and* noise margins up
together. A threshold calibrated on a small pool silently starts
misclassifying on a big one.

Concretely, that is what happened here: on an 18-person pool the baseline
was ≈0.52 and noise topped out at 0.058; at 138 people the baseline fell to
≈0.4966 and the very same no-counterpart people now measure ≈0.075 — which
sailed straight past the old `≤ 0.06` noise ceiling and would have been
reported as "inconclusive" instead of "no match".

So: **always record the pool size next to the numbers**, and re-run the
probe after the pool changes materially — not only after a provider or
scoring change.

Measured on `gemini-embedding-001`, on a 138-person pool (18 ground-truth
people whose true counterpart is known in advance + 120 background
population), via `scripts/seed-demo.mjs --probe`:

```
true matches   margin 0.1492 – 0.2791   (10 pairs; the true counterpart was
                                         the #1-ranked candidate in 10 of 10)
no counterpart margin up to 0.0756      (strongest noise sample)
                       ↑ the groups do not overlap, but the gap has narrowed
                         to (0.0756, 0.1492). The thresholds above sit inside
                         it: 0.019 of headroom below the weakest true match,
                         0.014 above the strongest noise sample.
```

Baseline is a random 50-person sample, so margins jitter by roughly ±0.003
between runs — both headrooms are 4–6× that. This supersedes the earlier
18-person-pool calibration (signal ≥0.14 / noise ≤0.06); those numbers are
no longer safe to apply.

Provenance, because a calibration record is worthless without it. Both sides
were measured independently on 2026-08-05 and both agree with the matching
engine owner's own run (which reported 0.0745 and 0.1500):

- **Noise side** — three runs of `seed-demo.mjs --probe` gave 0.0722 /
  0.0745 / 0.0756 on the two designated no-counterpart people. The table is
  calibrated against the worst of the three.
- **True side** — derived from `scripts/validate-cutoff.mjs`, which scores
  every pair directly instead of through `/v1/recommendations`. That detour
  is essential: recommendations exclude anyone you already have an edge
  with, so once the seeded pairs are connected, a probe of them silently
  measures noise (their counterpart has been filtered out) and reports a
  confident, wrong number. `score_baseline` has no such filter — it excludes
  only yourself — so the baseline stays valid and margin = partner score −
  baseline is sound.

If you re-measure, prefer `validate-cutoff.mjs` for the true side for that
reason; a `--probe` run is only trustworthy on a freshly seeded pool, before
the connect step.

**Corroborating signal — how many rows came back.** When a real match
exists the relative cutoff prunes hard, so the page comes back short; a
noise case returns a full page. On the same 138-person pool at the current
`0.10` cutoff: **1.2 rows on average for a person with a real counterpart,
125.5 for a person without one.** A short page is therefore strong evidence
*for* a real match, and a full page alongside a low margin is the noise
signature. Use it as a sanity check on the margin, never as a replacement
for it — page length depends on the cutoff, which is tuned separately and
was 12.1 rows on a match page as recently as the `0.15` setting.

The failure mode this prevents, measured 2026-08-05: a person seeking a
deep-sea welding contractor got a full page whose top match was a drone
operator, at `match_score` 0.578 — an agent that skipped calibration reads
"0.58, reasonable" and sends the request. `top_margin` was 0.0756, i.e.
noise. Note that this raw score is *higher* than several genuine matches
score elsewhere in the same pool, which is exactly why `match_score` alone
can never be read as quality (§2).

`baseline_stddev` is available if you want the spread. Do **not** turn it
into a z-score: when a person is uniformly far from everyone, the spread
collapses and `margin / stddev` reports a confident ~1.9 on exactly the
noise you are trying to detect.

### 2. `match_score` is a ranking signal, not a probability

Two people with nothing whatsoever in common still score **≈0.50 on
average, and the best stranger on a page reaches ≈0.58** (138-person pool,
2026-08-05). A raw 0.58 means "stranger", not "58% match". Like every
number here this floor moves with pool size — see §1.

- There is no absolute threshold you can set by intuition. Don't invent
  one. `top_margin` is the calibrated instrument; `match_score` only
  orders rows *within one response*.
- Don't compare scores across responses, across users, or across embedding
  providers — the floor moves.
- Don't convert it to a percentage, a star rating, or "confidence".
- Short pages are normal. The API already dropped candidates scoring more
  than `MATCH_RELATIVE_CUTOFF` (currently 0.10) below this page's top row.
  Three rows back from a `limit=20` request is the filter working, not an
  error. This is a *within-page* filter — it is not the `top_margin`
  threshold from §1, and the two values are not interchangeable.

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
  "calibration": { "baseline": 0.502, "baseline_stddev": 0.023, "sample_size": 50,
                   "top_score": 0.578, "top_margin": 0.076, "cutoff": 0.10 },
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
