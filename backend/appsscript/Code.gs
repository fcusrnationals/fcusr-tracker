/**
 * FCUSR Task Tracker — Google Apps Script backend (comparison build)
 *
 * Data lives in one Google Sheet in your own FCUSR Google account. Nothing is
 * hosted anywhere else and there is no bill, ever.
 *
 * Identity note, and it matters for the comparison:
 * this backend does NOT store passwords. It uses the Google account the person
 * is already signed in with (Session.getActiveUser). That is genuinely safer
 * than any password store I could hand-roll here — but it means people sign in
 * with their Google/@filamer account rather than a separate password the app
 * manages. Supabase is the other way round: its own email+password, changeable
 * inside the app.
 *
 * SETUP
 *  1. Create a Google Sheet in the FCUSR account. Name it "FCUSR Tracker".
 *  2. Extensions → Apps Script. Delete the sample, paste this file, save.
 *  3. Run setup() once and accept the permission prompt.
 *  4. Deploy → New deployment → Web app.
 *       Execute as:      Me
 *       Who has access:  Anyone with a Google account   (or your Workspace)
 *  5. Copy the /exec URL into assets/js/backend/config.js
 */

var SHEETS = {
  units:    ['id', 'kind', 'name', 'code', 'active'],
  profiles: ['id', 'email', 'full_name', 'position', 'unit_id', 'access', 'is_head', 'active', 'valid_until', 'created_at'],
  events:   ['id', 'unit_id', 'title', 'description', 'date_start', 'date_end', 'venue', 'head_id', 'status', 'created_at'],
  tasks:    ['id', 'event_id', 'title', 'remarks', 'assignee_id', 'due_date', 'priority', 'status', 'hold_reason', 'completed_at', 'created_at'],
  reports:  ['id', 'event_id', 'description', 'drive_link', 'status', 'created_at'],
  audit:    ['id', 'actor_email', 'actor_name', 'action', 'entity', 'entity_id', 'detail', 'created_at']
};

function ss() { return SpreadsheetApp.getActiveSpreadsheet(); }

function sheet(name) {
  var s = ss().getSheetByName(name);
  if (!s) {
    s = ss().insertSheet(name);
    s.appendRow(SHEETS[name]);
    s.setFrozenRows(1);
  }
  return s;
}

/** Run once from the editor. Creates the tabs and the starting units. */
function setup() {
  Object.keys(SHEETS).forEach(function (n) { sheet(n); });

  if (rows('units').length === 0) {
    [['national', 'FCUSR Nationals', 'NAT'],
     ['comelec', 'Commission on Elections', 'COMELEC'],
     ['judiciary', 'Supreme Court', 'JUDICIARY'],
     ['province', 'College of Arts and Sciences', 'CAS'],
     ['province', 'College of Business and Accountancy', 'CBA'],
     ['province', 'College of Criminal Justice', 'CCJ'],
     ['province', 'College of Education', 'COED'],
     ['province', 'College of Engineering', 'COE'],
     ['province', 'College of Nursing', 'CON'],
     ['province', 'College of Computer Studies', 'CCS'],
     ['province', 'Senior High School', 'SHS'],
     ['province', 'Junior High School', 'JHS'],
     ['province', 'Elementary', 'ELEM']
    ].forEach(function (u) {
      sheet('units').appendRow([uid(), u[0], u[1], u[2], true]);
    });
  }

  // The first person to run setup becomes the founding national officer,
  // otherwise nobody could enrol anyone.
  var email = (Session.getEffectiveUser().getEmail() || '').toLowerCase();
  if (email && !findProfile(email)) {
    var nat = rows('units').filter(function (u) { return u.kind === 'national'; })[0];
    sheet('profiles').appendRow([uid(), email, 'Founding Officer', 'President',
      nat ? nat.id : '', 'officer', true, true, '', new Date().toISOString()]);
  }
  return 'Setup complete for ' + email;
}

function uid() { return Utilities.getUuid(); }

function rows(name) {
  var s = sheet(name);
  var values = s.getDataRange().getValues();
  if (values.length < 2) return [];
  var head = values[0];
  return values.slice(1).map(function (r, i) {
    var o = { _row: i + 2 };
    head.forEach(function (h, c) { o[h] = r[c]; });
    return o;
  });
}

function findProfile(email) {
  var e = String(email || '').toLowerCase();
  return rows('profiles').filter(function (p) {
    return String(p.email).toLowerCase() === e && p.active !== false;
  })[0] || null;
}

function unitById(id) {
  return rows('units').filter(function (u) { return u.id === id; })[0] || null;
}

function log(actor, action, entity, entityId, detail) {
  sheet('audit').appendRow([uid(), actor ? actor.email : '', actor ? actor.full_name : '',
    action, entity, entityId, detail, new Date().toISOString()]);
}

/* ------------------------------------------------------------ the API */

function doGet(e) { return json({ ok: true, service: 'FCUSR Tracker', time: new Date().toISOString() }); }

function doPost(e) {
  var body = {};
  try { body = JSON.parse(e.postData.contents || '{}'); } catch (err) { /* empty */ }
  var action = String(body.action || '');

  try {
    // Identity comes from Google, never from the request body — a caller cannot
    // claim to be someone else.
    var email = (Session.getActiveUser().getEmail() || '').toLowerCase();
    if (!email) return json({ ok: false, error: 'Not signed in with a Google account.' });

    var actor = findProfile(email);
    if (!actor && action !== 'whoami') {
      return json({ ok: false, error: 'Your account is not enrolled yet.' });
    }

    switch (action) {
      case 'whoami':  return json({ ok: true, profile: actor ? publicProfile(actor) : null, email: email });
      case 'units':   return json({ ok: true, units: rows('units') });
      case 'roster':  return json({ ok: true, roster: roster(actor) });
      case 'enrol':   return json({ ok: true, id: enrol(actor, body) });
      case 'audit':   return json({ ok: true, entries: recentAudit(actor) });
      default:        return json({ ok: false, error: 'Unknown action: ' + action });
    }
  } catch (err) {
    return json({ ok: false, error: String(err && err.message || err) });
  }
}

function json(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

function publicProfile(p) {
  var u = unitById(p.unit_id);
  return {
    id: p.id, email: p.email, full_name: p.full_name, position: p.position,
    unit_id: p.unit_id, unit_name: u ? u.name : '', unit_kind: u ? u.kind : '',
    access: p.access, is_head: p.is_head === true || p.is_head === 'TRUE'
  };
}

function isNational(actor) {
  var u = unitById(actor.unit_id);
  return !!u && u.kind === 'national' && actor.access === 'officer';
}

function roster(actor) {
  var all = rows('profiles');
  var list = isNational(actor) ? all : all.filter(function (p) { return p.unit_id === actor.unit_id; });
  return list.map(publicProfile);
}

function recentAudit(actor) {
  if (!isNational(actor)) throw new Error('Only national officers may read the log.');
  return rows('audit').slice(-100).reverse();
}

/**
 * The same single door as the Supabase version. The typed position is a label
 * with no power; authority comes from unit and access, checked here.
 */
function enrol(actor, body) {
  var email = String(body.email || '').trim().toLowerCase();
  var name = String(body.full_name || '').trim();
  var position = String(body.position || '').trim();
  var unitId = String(body.unit_id || '');
  var access = String(body.access || '');

  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new Error('That email address is not valid.');
  if (!name) throw new Error('A name is required.');
  if (access !== 'officer' && access !== 'volunteer') throw new Error('Access must be officer or volunteer.');

  var target = unitById(unitId);
  if (!target) throw new Error('That unit does not exist.');
  if (findProfile(email)) throw new Error('Someone is already enrolled with that email.');

  var actorUnit = unitById(actor.unit_id);
  var actorKind = actorUnit ? actorUnit.kind : '';
  var head = actor.is_head === true || actor.is_head === 'TRUE';

  if (isNational(actor)) {
    // Nationals may enrol anyone, anywhere.
  } else if (head && actor.unit_id === unitId) {
    if (actorKind === 'province' && access !== 'volunteer') {
      throw new Error('A province may enrol volunteers only. Elected and appointed posts are enrolled by the National government.');
    }
  } else {
    throw new Error('You may not enrol members for that unit.');
  }

  var id = uid();
  sheet('profiles').appendRow([id, email, name, position, unitId, access, false, true, '',
    new Date().toISOString()]);
  log(actor, 'enrol', 'profile', id, access + ' · ' + position + ' · ' + email);
  return id;
}
