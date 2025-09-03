# LinkedIn Posts Dashboard (Standalone)

A minimal Next.js (Pages Router) + Tailwind project that renders a LinkedIn posts dashboard from CSV.

## Quick start
```bash
npm install
npm run dev
```

Visit http://localhost:3000/

## Data files (in `public/`)
- `linkedin_posts.csv` (**required**)
- `linkedin_authors.csv` (**optional curated dropdown, header: `author`**)
- `linkedin_tags.csv` (**optional curated dropdown, header: `tag`**)

### `linkedin_posts.csv` headers (exact)
```
Include,posted_iso,author,headline,summary,tags,post_url
```
- **Include**: Y/Yes/1/true = include (blank also includes). N/0/false = exclude
- **posted_iso**: `YYYY-MM-DD` preferred (full ISO ok)
- **tags**: comma **or** semicolon separated
- **author**: plain text (no URL)
- **post_url**: full LinkedIn post URL

## Curated dropdowns
If `linkedin_authors.csv` and/or `linkedin_tags.csv` exist, their values are used in the dropdowns. Otherwise, the app computes unique values from `linkedin_posts.csv`. Search still searches everything.

## Notes
- Tailwind is preconfigured (`styles/globals.css`, `tailwind.config.js`).
- The dashboard fetches CSVs with `cache: "no-store"` to avoid caching issues during edits.
