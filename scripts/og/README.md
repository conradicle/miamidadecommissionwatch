# Share card (link-preview image)

`assets/img/share-card.png` is the image WhatsApp, iMessage, Slack, Facebook, X and
LinkedIn show when anyone shares a miamidadecommissionwatch.com link. Every public
page uses it.

- **Template:** `scripts/og/share-card.html`. It loads the site's own `css/style.css`,
  so the colors (`--accent-strong`, `--gold-600`, `--paper`, `--heading-color`,
  `--eyebrow-color`) and fonts (Lora, Inter) are the live site's. Keep anything with
  meaning inside the centered 1000x500 safe zone (`.sc-safe`): WhatsApp and iMessage
  crop the edges.
- **Tags:** `scripts/lib/social.mjs` writes og:image, its size and alt text,
  og:site_name, twitter:card and twitter:image on every page in `dist/` at build time,
  replacing whatever the page source says. Each page's own og:title, og:description
  and og:url are left alone. The build fails if a shareable page is missing a tag.

## Regenerating after a design change

1. Edit `scripts/og/share-card.html` (or `css/style.css`).
2. Run `node scripts/og/render-share-card.mjs`. It needs Google Chrome (set `CHROME`
   to its path if it is not in `/Applications`) and fails if the PNG is over 300 KB.
3. Bump `SHARE_CARD_VERSION` in `scripts/lib/social.mjs`. Link-preview caches key on
   the full URL, so without a new `?v=` people keep seeing the old card.
4. `npm run build`, commit the PNG, the template and `social.mjs`, push.
5. Optional: paste a URL into https://developers.facebook.com/tools/debug/ and press
   "Scrape Again" to refresh Facebook and WhatsApp right away.
