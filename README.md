# Gold & Silver rate — project files

Live gold and silver rate for goldsmiths and jewellers.
Indian rate is the headline number; international spot sits underneath.

```
site/index.html        the rate board page
backend/server.js      fetches spot, applies the formula, serves /api/rate
android-widget/        home screen widget (build this later, not now)
```

---

## Order of work

### 1. Put the page online (do this first — you need a URL for the API signup)

1. github.com → sign up → **New repository** → name `goldrate` → **Public** → Create
2. **Add file → Upload files** → upload `site/index.html` **to the repo root**
3. **Settings → Pages** → Source: *Deploy from a branch* → Branch `main`, folder `/root` → Save
4. Wait 1–2 minutes. Your URL: `https://yourusername.github.io/goldrate/`

The page works right away using simulated prices, so there is something
real at the URL before you have a key.

### 2. Get the API key

Register at goldpricez.com/key/registration and give it the URL from
step 1. Send the activation email they ask for.

### 3. Run the backend

Install Node 18+ from nodejs.org, then:

```bash
cd backend
GOLD_API_KEY=your_key_here node server.js
```

Open http://localhost:3000/api/rate

If you get "unexpected shape", add `console.log(data)` inside
`fetchUpstream()`, run it again, and correct the field names to match
what your provider actually returns. That function is the only place in
the whole project that knows which provider you use.

### 4. Connect the page to the backend

In `site/index.html`, delete `simulate()` and fetch from your
`/api/rate` endpoint instead. See the comment block at the top of the
`<script>` tag.

### 5. Deploy the backend

Render.com (free) → New → Web Service → connect your GitHub repo
→ start command `node server.js`
→ Environment: add `GOLD_API_KEY`

Then change the fetch URL in the page to your `.onrender.com` address
and re-upload it.

### 6. Calibrate — the step that decides everything

For one week, write down two numbers each morning:

| Date | Rate your father quoted | Rate your site showed |
|------|------------------------|----------------------|

The average gap is your premium. Set it in **Rate settings** on the page
and as `GOLD_PREMIUM` on the server. Repeat until they match.

Trust in the number is the entire product. Do not skip this to get to
the fun parts.

### 7. Send it to 10 jewellers

Watch one thing: **do they open it again the next day without you
reminding them?** That answers whether the app is worth building.

Do not ask "do you like it". Everyone says yes to be polite.

---

## Rules to not break

- **The API key never goes in the browser.** It stays on the server.
  One fetch per minute serves every visitor, so 10 users and 10,000
  users cost you the same.
- **Never label your number as MCX.** It is a calculated indicative
  rate. Showing exchange data publicly needs a paid licence, and
  renaming the label does not change where the data came from.
- **Duty, GST and premium stay editable.** Duty went 6% → 15% overnight
  in May 2026. Never hardcode them.
- **Never show a blank rate.** An older number with an honest timestamp
  beats a dash.
