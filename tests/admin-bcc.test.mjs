import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
const source = readFileSync(new URL('../js/admin-bcc.js', import.meta.url), 'utf8');
const now = '2026-11-16T16:00:00Z';
class Clock extends Date {
  constructor(...args) { super(...(args.length ? args : [now])); }
  static now() { return new Date(now).getTime(); }
}
const flush = () => new Promise(resolve => setImmediate(resolve));
async function setup(overrides = {}, mode = 'success') {
  const meeting = { id: 'meeting', meeting_date: '2026-11-17', title: 'BCC Meeting', start_time: '09:30', location: 'Miami', is_open: true, signup_closes_at: '2026-11-16T03:00:00Z', ...overrides };
  const nodes = {}, writes = [];
  const el = id => nodes[id] ||= { value: '', checked: false, textContent: '', innerHTML: '', events: {}, hidden: false,
    addEventListener(type, fn) { this.events[type] = fn; }, focus() { nodes.focus = id; }, scrollIntoView() {},
    reset() { for (const n of Object.values(nodes)) { if (typeof n === 'object') { n.value = ''; n.checked = false; } } }
  };
  const client = { from(table) {
    let fields, operation;
    const q = { select() { return q; }, order() { return q; }, gte() { return q; }, eq() { return q; },
      update(value) { fields = value; operation = 'update'; return q; }, insert(value) { fields = value; operation = 'insert'; return q; },
      then(resolve, reject) { return Promise.resolve({ data: table === 'bcc_meetings' ? [{ ...meeting }] : [] }).then(resolve, reject); },
      single() {
        writes.push({ operation, fields: { ...fields } });
        if (mode === 'network') return Promise.reject(new Error('offline'));
        if (mode === 'error') return Promise.resolve({ error: { message: 'Permission denied' } });
        if (mode === 'empty') return Promise.resolve({ data: null });
        Object.assign(meeting, fields);
        if (fields.signup_closes_at === null) meeting.signup_closes_at = '2026-11-22T04:59:59Z';
        return Promise.resolve({ data: { ...meeting } });
      }
    };
    return q;
  } };
  const window = {};
  vm.runInNewContext(source, { window, document: { getElementById: el, createElement: () => ({ set textContent(s) { this.innerHTML = s; } }) }, supabaseClient: client, Date: Clock, Intl });
  window.initAdminBcc({});
  await flush();
  const click = dataset => el('bcc-meeting-list').events.click({ target: { closest: () => ({ dataset }) } });
  const submit = async () => { el('bcc-meeting-form').events.submit({ preventDefault() {} }); await flush(); };
  return { el, writes, meeting, click, submit };
}
for (const is_open of [true, false]) {
  test(`expired deadline routes to an editable reopen flow (is_open=${is_open})`, async () => {
    const h = await setup({ is_open });
    h.click({ toggle: 'meeting' });
    assert.equal(h.writes.length, 0);
    assert.equal(h.el('bcc-open').checked, true);
    assert.equal(h.el('bcc-form-heading').textContent, 'Reopen sign-ups');
    assert.match(h.el('bcc-form-status').textContent, /future closing time/);
    await h.submit();
    assert.equal(h.writes.length, 0, 'expired deadlines must not be saved as open');
    h.el('bcc-closes').value = '2026-11-17T04:59:00Z';
    h.el('bcc-closes').events.input();
    await h.submit();
    assert.equal(h.writes.length, 1);
    assert.equal(h.writes[0].fields.is_open, true);
    assert.equal(h.writes[0].fields.signup_closes_at, '2026-11-17T04:59:00.000Z');
    assert.equal(h.el('bcc-form-status').textContent, 'Saved.');
  });
}
for (const is_open of [true, false]) {
  test(`unexpired signup window toggles normally (is_open=${is_open})`, async () => {
    const h = await setup({ is_open, signup_closes_at: '2026-11-17T04:59:00Z' });
    h.click({ toggle: 'meeting' }); await flush();
    assert.equal(h.writes[0].fields.is_open, !is_open);
    assert.equal(h.meeting.is_open, !is_open);
    assert.match(h.el('bcc-form-status').textContent, is_open ? /closed/ : /opened/);
  });
}
test('past meetings cannot be reopened', async () => {
  const h = await setup({ meeting_date: '2026-11-15', is_open: false });
  h.click({ toggle: 'meeting' });
  assert.equal(h.writes.length, 0);
  assert.match(h.el('bcc-form-status').textContent, /Past meetings/);
});
test('creating an open meeting rejects an expired default and accepts a future default', async () => {
  const h = await setup();
  h.el('bcc-date').value = '2026-11-17'; h.el('bcc-open').checked = true;
  await h.submit(); assert.equal(h.writes.length, 0);
  h.el('bcc-date').value = '2026-11-24'; await h.submit();
  assert.equal(h.writes.length, 1); assert.equal(h.writes[0].fields.signup_closes_at, null);
});
test('moving the meeting date validates the default that the database trigger will apply', async () => {
  const h = await setup({ meeting_date: '2026-11-24', signup_closes_at: '2026-11-22T04:59:59Z' });
  h.click({ edit: 'meeting' }); h.el('bcc-date').value = '2026-11-17'; await h.submit();
  assert.equal(h.writes.length, 0);
  assert.match(h.el('bcc-form-status').textContent, /deadline has already passed/);
});
for (const mode of ['error', 'empty', 'network']) {
  test(`${mode} update failure never reports a successful opening`, async () => {
    const h = await setup({ is_open: false, signup_closes_at: '2026-11-17T04:59:00Z' }, mode);
    h.click({ toggle: 'meeting' }); await flush();
    assert.equal(h.meeting.is_open, false);
    assert.match(h.el('bcc-form-status').textContent, /Could not/);
    assert.match(h.el('bcc-form-status').className, /error/);
  });
}
test('network failure while saving reenables the form', async () => {
  const h = await setup({}, 'network'); h.click({ toggle: 'meeting' });
  h.el('bcc-closes').value = '2026-11-17T04:59:00Z'; h.el('bcc-closes').events.input(); await h.submit();
  assert.equal(h.el('bcc-submit-btn').disabled, false);
  assert.match(h.el('bcc-form-status').textContent, /Could not reach/);
});
