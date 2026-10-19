# MDCW document templates

Source of truth for how official Miami-Dade Commission Watch documents look.
Every Meeting Summary and Agenda Summary is written as HTML from these
templates, built into a watermarked PDF with WeasyPrint, and published through
the staff dashboard as both a web page and the official PDF.

## The two documents

| Document | When | Number | Template |
|---|---|---|---|
| Agenda Summary | Before each regular BCC meeting. One long document (about 60 pages): backstory, legislative history, fiscal impact and a plain-language explanation of each item. | `MDCW-AS-YYYY-MMDD` | `agenda-summary-TEMPLATE.html` |
| Meeting Summary | After each meeting: what passed, failed, was deferred or withdrawn, vote counts, major developments, public comment. | `MDCW-MS-YYYY-MMDD` | `meeting-summary-TEMPLATE.html` |

`MMDD` is the meeting date, not the issue date: the Agenda Summary for the
October 20, 2026 meeting is `MDCW-AS-2026-1020` even though it is issued on
October 19. A future Spanish or Haitian Creole edition adds `-ES` or `-HT`.

`example-2026-10-20-agenda-summary.html` is a complete worked example built
from the content in the original kit. Use it to test the upload flow.

## What is in this folder

```
mdcw-brief.css                       house style: page frame, watermark, running header and footer,
                                     cover, contents, tables, item blocks, outcome labels
agenda-summary-TEMPLATE.html         long pre-meeting document (cover, contents, one chapter per item)
meeting-summary-TEMPLATE.html        post-meeting document (masthead, results table, item outcomes)
example-2026-10-20-agenda-summary.html   filled-in Agenda Summary for testing
assets/                              seal, watermark, page frame, Lora and Inter fonts
tools/contact-sheet.py               renders every page of a PDF into one PNG for a quick visual check
reference/                           the kit as it arrived: the retired short "Meeting Brief", the
                                     original "Policy Briefing" skeleton and its README
```

The website mirrors the look of `mdcw-brief.css` in `css/document.css` (same
colors, fonts and components, sized for screens). If you change a component
here, change it there too.

## Making a document

1. Copy the template into this folder and rename it, for example
   `2026-11-17-agenda-summary.html`. Keep it here: the stylesheet and images
   are linked relatively.
2. Update the `<meta name="mdcw:...">` tags at the top. The dashboard fills
   its upload form from them and refuses an upload whose document number or
   version does not match the form.
   - `description`: the two or three sentences shown on the index page
   - `mdcw:doc-type`: `agenda-summary` or `meeting-summary`
   - `mdcw:meeting-date`, `mdcw:issued`: `YYYY-MM-DD`
   - `mdcw:document-number`, `mdcw:version`
   - `mdcw:items`: item numbers covered, comma separated (`11A5, 8O1, 8N2`); readers can search by these
   - `mdcw:keywords`: comma separated
3. Update the two running-header lines (`doctype-string`, `docno-string`), the
   cover or masthead, the document control strip and the certification line
   at the end. They all repeat the number, version and date.
4. Write the content. Remove every `class="fill"` template note and every
   `[ bracketed ]` placeholder; the build script warns about any left in.
5. Give every chapter heading an `id` or let the dashboard name it from the
   heading text. The web page builds its table of contents from the `h2` and
   `h3` headings.

House rules for the text are in `EDITORIAL-REVIEW-CHECKLIST.md` at the repo
root: nonpartisan, no characterizing items or officials, primary sources only.

## Building the PDF

Install WeasyPrint once:

```
pip install weasyprint
```

Then from the repo root:

```
npm run build-doc -- document-templates/2026-11-17-agenda-summary.html
```

The PDF is written next to the HTML with the same name (add `-o out.pdf` to
put it elsewhere). The script prints the page count and size, and warns about
missing metadata, a document number that does not fit the type and date, and
leftover template notes. PDFs in this folder are git-ignored; the published
copy lives in Supabase Storage.

For a quick look at every page at once:

```
python3 document-templates/tools/contact-sheet.py file.pdf sheet.png
```

(needs `pdftoppm` from poppler and Pillow).

## Publishing

In the staff dashboard, **Documents** tab:

1. Choose the HTML file first. The form fills in from its metadata.
2. Choose the PDF built from that HTML.
3. **Save draft.** The server checks the PDF (real PDF, under 30 MB, no
   scripts or attachments, page count read from the file) and sanitizes the
   HTML (scripts, event handlers, forms, frames, embeds, SVG and external
   images are removed). Only the sanitized HTML is stored.
4. **Preview** the draft. It is the public page exactly as it will appear,
   visible only to signed-in staff.
5. **Publish.** The PDF is copied to the public bucket under a versioned name
   and the site rebuilds itself (about a minute). Readers download it from
   our own address, `/documents/files/...`; the storage service behind it
   never shows in a link.
6. **Subscribers are emailed** with the document type, meeting date, summary
   and a link to the page, as soon as that page is live. Keep the tab open
   for a minute or two; if you close it first, the document's card shows an
   **Email subscribers** button. Each document is emailed once, on its first
   publication. Corrections are emailed only when marked (see below).

Publishing is permanent. Nothing published can be edited, unpublished or
deleted, from the dashboard or from the database. The one exception is
`supabase/maintenance_remove_document.sql`, for a document that should never
have existed (a test upload, or a file published under the wrong meeting). A
wrong fact is a correction, not a removal.

## Corrections

A correction is a new version, never an overwrite:

1. Fix the HTML and raise the version everywhere it appears
   (`mdcw:version`, control strip, certification line): 1.0 becomes 1.1.
2. Rebuild the PDF.
3. In the dashboard, click **Upload a correction** on the document, choose
   both files and say what the version corrects. The note is public.
4. If the correction changes a fact (a vote count, a dollar figure, an
   outcome), tick **Email subscribers about this correction**. It is off by
   default. Subscribers then get an email with the subject "Correction:"
   plus the document title, the correction note and a link, once the
   corrected page is live.
5. Preview, then publish.

The public page then says "Updated [date], version 1.1" with the note, and
the version history lists every version with its own PDF.

## Translation

The web page around a document (menus, buttons, the "Official English
edition" line) goes through the site's language switcher like every other
page. The document text and its contents list are marked `notranslate`, so
the official text always reads as published. When Spanish and Haitian Creole
editions exist, they are uploaded as their own documents (language `es` or
`ht`, number ending `-ES` or `-HT`) and listed on the English page.

## Fonts

Lora and Inter are both licensed under the SIL Open Font License 1.1, which
allows bundling them with documents and websites. See `assets/FONTS-LICENSE.txt`.
