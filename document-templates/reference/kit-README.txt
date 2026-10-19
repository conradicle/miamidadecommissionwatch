MDCW Briefing Template kit

Files
- mdcw-brief.css: the house style (frame, watermark, header/footer, tables, item blocks, cover, contents)
- oct20-meeting-brief.html: the short Meeting Brief (copy and rename for each meeting)
- oct20-policy-briefing-TEMPLATE.html: the long Policy Briefing skeleton (cover, contents, one chapter per item)
- assets/: seal, watermark, frame, Lora fonts

Each new meeting: change the two lines at the top of the HTML (running header and document number), the masthead date, the document control strip, and the content.

Numbering: MDCW-MB-YYYY-MMDD for the Meeting Brief, MDCW-PB-YYYY-MMDD for the Policy Briefing.

Build: pip install weasyprint, then
  weasyprint oct20-meeting-brief.html MDCW-Meeting-Brief-Oct20.pdf
Or send the draft text to Claude and ask it to build the PDF with this kit.
