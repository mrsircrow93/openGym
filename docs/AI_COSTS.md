# AI costs — what a paid plan has to cover

Every AI feature is one call to the Anthropic Messages API, made either by the server with the
instance's key (what a subscription pays for) or by the browser with the user's own key (free
for us). This note sizes the server-paid path so the price of a plan can be set with numbers,
not vibes.

## What is already in place

- **Per-user ledger.** `api/server.js` records every server-paid call: tokens in/out, feature
  name, and USD at list price, per profile per month, in `data/db.json` under `aiUsage`.
- **Monthly cap.** `AI_MONTHLY_USD_CAP` (env, USD per user per month). `0` = unlimited. When a
  profile hits the cap, AI routes answer `402` and the app shows the error. A paid tier is just
  a per-user cap instead of a global one (see `docs/BILLING.md`).
- **Read-outs.** `GET /api/ai/usage` (own profile, shown in Settings → AI features) and
  `GET /api/admin/ai-usage` (everyone, for the admin dashboard).
- **Model choice is one env var** (`ANTHROPIC_MODEL`), so the cost lever is trivial to pull.

## Price per call (list prices, USD per million tokens)

| Model      | Input | Output |
|------------|------:|-------:|
| Haiku 4.5  | 1.00  | 5.00   |
| Sonnet 5   | 2.00  | 10.00  |
| Opus 5     | 5.00  | 25.00  |

Typical token use per feature, measured shape of the prompts in `api/server.js`
(a 1024-px photo ≈ 1 100 input tokens):

| Feature (route)             | In tokens | Out tokens | Haiku 4.5 | Sonnet 5 |
|-----------------------------|----------:|-----------:|----------:|---------:|
| Set parsing (`parse-set`)   | 250       | 80         | $0.0007   | $0.0013  |
| Coach read-out (`coach`)    | 3 500     | 450        | $0.0058   | $0.0115  |
| Identify machine (`identify-exercise`) | 1 400 | 150   | $0.0022   | $0.0043  |
| Swap suggestions (`alternatives`) | 2 800 | 300      | $0.0043   | $0.0086  |
| Meal photo (`analyze-meal`) | 1 900     | 700        | $0.0054   | $0.0108  |
| Meal correction             | 2 300     | 700        | $0.0058   | $0.0116  |
| Trainer plan (`trainer-plan`) | 6 500   | 2 500      | $0.0190   | $0.0380  |

## Monthly cost per active user (three usage profiles)

| Profile   | Meals/day | Corrections | Plans/mo | Coach/mo | Swaps+ID/mo | Sets parsed/mo | **Haiku** | **Sonnet** |
|-----------|----------:|------------:|---------:|---------:|------------:|---------------:|----------:|-----------:|
| Light     | 1         | 0.2         | 0.5      | 2        | 4           | 20             | $0.22     | $0.44      |
| Typical   | 3         | 1           | 1        | 4        | 10          | 60             | $0.72     | $1.45      |
| Heavy     | 5         | 2           | 2        | 8        | 25          | 150            | $1.42     | $2.85      |

So: **Sonnet 5 for photos and plans, Haiku for the small text calls** is the sweet spot —
roughly **$1–1.5 per typical user per month**, under $3 for a heavy one. A $4.99/month tier
leaves ~65 % gross margin at typical use even on Sonnet; $2.99 is only safe on Haiku or with a
cap around $1.50. Meal photos are the volume driver — the cap protects against the one user
who logs every snack.

## Recommended plan shape

- **Free**: everything except server-paid AI. AI still works with the user's own key
  (already built — Settings → AI features). Progress photos off (storage cost).
- **Pro, $4.99/mo or $39.99/yr**: server-paid AI with a **$3/user/month cap** (≈ 250 meal
  photos on Sonnet), progress photos, trainer plans. Cap is generous for real use and makes
  abuse cost-bounded.
- Optional **AI top-up** later: +$2 for +$3 of cap, only if the cap turns out to bite.

## Levers that cut cost without touching the price

1. Route by feature: `ANTHROPIC_MODEL` today is one model for everything. Split it into
   `ANTHROPIC_MODEL_VISION` (Sonnet) and `ANTHROPIC_MODEL_TEXT` (Haiku). ~40 % saving.
2. Prompt caching on the trainer system prompt + exercise list (the same ~5 k tokens on every
   plan; cache reads are 10 % of price).
3. Resize meal photos to 800 px instead of 1024 (≈ 35 % fewer image tokens, negligible
   accuracy loss for plates).
4. Batch API is not applicable — every call is interactive.

## What to watch after launch

- `GET /api/admin/ai-usage` → total USD vs MRR, and the top-10 users by spend.
- Share of users hitting the cap (should be < 5 %; if higher, raise cap or add top-ups).
- Meal-photo corrections per photo (a proxy for model quality; > 0.5 means move to Sonnet).
