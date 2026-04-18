# Bryan RSS — CLAUDE.md

## What this project is

A personal RSS reader built on [OsmosFeed](https://github.com/osmoscraft/osmosfeed). It fetches 40+ curated feeds, generates a static HTML page, and deploys to GitHub Pages. The reader UI is vanilla JS with no framework.

Live site: https://bryankulba.github.io/bryan-rss/

## Stack

- **Generator**: `@osmoscraft/osmosfeed` v1.15.1 — reads `osmosfeed.yaml`, fetches feeds, renders via Handlebars template
- **Frontend**: Vanilla JS (`static/reader.js`), CSS (`static/reader.css`), design tokens (`tokens.json` → `static/tokens.css`)
- **Storage**: Browser localStorage + optional GitHub Gist sync for cross-device state
- **Deploy**: GitHub Actions → GitHub Pages. Runs on push and on a cron (6am/10am/2pm/6pm/10pm MDT)

## Key files

| File | Purpose |
|---|---|
| `osmosfeed.yaml` | Feed sources + site config |
| `includes/index.hbs` | Handlebars template for the generated HTML |
| `static/reader.js` | All client-side interactivity |
| `static/reader.css` | Styles (references design tokens) |
| `tokens.json` | W3C design tokens (teal/beige palette, DM Sans/DM Serif) |
| `scripts/build-tokens.js` | Compiles tokens.json → static/tokens.css |
| `public/` | Build output (committed, served by GitHub Pages) |

## Commands

```bash
npm run build    # Full build: fetch feeds, generate public/
npm run serve    # Local dev server at http://localhost:8080 (serves public/)
npm run prebuild # Compile design tokens only
```

## localStorage keys

| Key | Value |
|---|---|
| `rss_read_ids` | JSON array of read article IDs |
| `rss_fav_ids` | JSON array of favourited IDs (derived from `rss_fav_data`) |
| `rss_fav_data` | JSON object map of rich favourite data (source of truth) |
| `rss_hide_read` | Boolean toggle |
| `rss_show_favs` | Boolean toggle |
| `rss_gist_id` | GitHub Gist ID for sync |
| `rss_gist_pat` | GitHub PAT (gist scope) for sync |

## Favourite data model

```json
{
  "article-id": {
    "id": "article-id",
    "favouritedAt": "2026-04-18T12:00:00.000Z",
    "postDate": "2026-04-15T08:00:00.000Z",
    "note": "Personal note",
    "tags": ["tag1", "tag2"]
  }
}
```

Synced to GitHub Gist as `favouriteData` inside `read-state.json`.

## Roadmap

These are planned but not yet started. Do not implement unless explicitly asked.

### Near term
- **Unfavourite / edit favourites** — a dedicated view to manage saved favourites, edit notes/tags, and remove entries. (Currently starring is one-way.)

### Medium term
- **Online favourites collection** — move `favouriteData` from Gist to a real backend (likely a simple PHP API or similar). Should be queryable and filterable by tag/theme. This is the foundation for everything below.

### Longer term
- **Newsletter / blog digest** — at a yet-undecided cadence, collect the period's favourites into a formatted blog post or newsletter. Claude will likely be involved in drafting the narrative.

## Conventions

- No JS framework — keep it vanilla
- No build step for JS/CSS beyond token compilation
- CSS uses design token custom properties (`--token-*`), mapped to semantic aliases (`--accent`, `--text`, etc.) in `:root`
- Favourite button is one-way from the feed (click ☆ → dialog → ★). Removal happens in a future dedicated view.
- `public/` is committed and served directly — always run `npm run build` before pushing UI changes that touch the template or feed data
