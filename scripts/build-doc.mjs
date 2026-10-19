#!/usr/bin/env node
// Builds an official MDCW document PDF from its HTML source with WeasyPrint.
//
//   npm run build-doc -- document-templates/example-2026-10-20-agenda-summary.html
//   npm run build-doc -- path/to/file.html -o path/to/out.pdf
//
// The PDF lands next to the HTML with the same name unless -o says otherwise.
// Both files then go up through the Documents tab of the staff dashboard: the
// PDF is the official download, the HTML becomes the web page.
//
// Before building it checks the things the dashboard will check on upload, so
// a mistake shows up here rather than after the upload: the mdcw:* metadata,
// a document number that matches the type and meeting date, and leftover
// template placeholders. Those are warnings, not failures, so a rough draft
// still builds.
//
// WeasyPrint is a Python tool: pip install weasyprint. The HTML must sit in
// document-templates/ (or anywhere with mdcw-brief.css and assets/ beside it),
// because the stylesheet and images are linked relatively.

import { existsSync, readFileSync, statSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { resolve, dirname, basename, extname, join } from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { countPdfPages, readDocumentMeta, checkDocumentNumber } = require('../api/_document-lib.js');

function fail(message) {
  console.error(`\nbuild-doc: ${message}\n`);
  process.exit(1);
}

const args = process.argv.slice(2);
let input = null;
let output = null;
for (let i = 0; i < args.length; i++) {
  if (args[i] === '-o' || args[i] === '--out') output = args[++i];
  else if (!input) input = args[i];
}
if (!input) fail('usage: npm run build-doc -- path/to/file.html [-o out.pdf]');

const src = resolve(input);
if (!existsSync(src)) fail(`no such file: ${input}`);
if (extname(src).toLowerCase() !== '.html') fail('the input must be an .html file');
const out = output ? resolve(output) : join(dirname(src), basename(src, extname(src)) + '.pdf');

if (!existsSync(join(dirname(src), 'mdcw-brief.css'))) {
  console.warn('warning: mdcw-brief.css is not next to this file, so the house style will not load.\n' +
    '         Keep working copies in document-templates/.');
}

// ---------- pre-flight checks ----------
const html = readFileSync(src, 'utf8');
const meta = readDocumentMeta(html);
const warnings = [];
if (!meta.docType) warnings.push('missing <meta name="mdcw:doc-type">');
if (!meta.meetingDate) warnings.push('missing <meta name="mdcw:meeting-date">');
if (!meta.documentNumber) warnings.push('missing <meta name="mdcw:document-number">');
if (!meta.version) warnings.push('missing <meta name="mdcw:version">');
if (!meta.summary) warnings.push('missing <meta name="description"> (the index summary)');
if (meta.docType && meta.meetingDate && meta.documentNumber) {
  const problem = checkDocumentNumber(meta.documentNumber, meta.docType, meta.meetingDate);
  if (problem) warnings.push(problem);
}
const placeholders = (html.match(/class="fill"/g) || []).length;
if (placeholders) warnings.push(`${placeholders} template note(s) (class="fill") still in the document`);
const brackets = (html.replace(/<[^>]*>/g, ' ').match(/\[ [^\]]{0,60} \]/g) || []).length;
if (brackets) warnings.push(`${brackets} [ bracketed ] placeholder(s) still in the text`);

// ---------- build ----------
function run(cmd, cmdArgs) {
  return spawnSync(cmd, cmdArgs, { stdio: 'inherit', cwd: dirname(src) });
}
let result = run('weasyprint', [src, out]);
if (result.error && result.error.code === 'ENOENT') {
  result = run('python3', ['-m', 'weasyprint', src, out]);
}
if (result.error || result.status !== 0) {
  fail('WeasyPrint did not produce a PDF. Install it with: pip install weasyprint');
}

const pdf = readFileSync(out);
const pages = countPdfPages(pdf);
const kb = Math.round(statSync(out).size / 1024);

console.log(`\nbuilt    ${out}`);
console.log(`         ${pages == null ? 'unknown number of' : pages} page(s), ${kb} KB`);
if (meta.documentNumber) {
  console.log(`         ${meta.documentNumber}, version ${meta.version || '?'}, meeting ${meta.meetingDate || '?'}`);
}
if (warnings.length) {
  console.log('\nwarnings (the PDF was still built):');
  for (const w of warnings) console.log(`  - ${w}`);
}
console.log('');
