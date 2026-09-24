/* FCUSR Task Tracker — data layer.
   Everything lives in one localStorage record. No backend, no accounts.
   Views never mutate state directly; they call the functions here, which stamp
   timestamps, persist, and notify subscribers so the screen redraws. */
(function (global) {
  'use strict';

  var KEY = 'fcusr.tracker.v1';
  var PERSON_KEY = 'fcusr.tracker.lastPerson';

  var STATUSES = ['Not Started', 'In Progress', 'For Review', 'Done', 'On hold'];
  var PRIORITIES = ['High', 'Medium', 'Low'];
  /* Cancelled sits with the finished ones rather than the running ones: an
     activity called off is over, and what is left of it is a record. It keeps
     its tasks, its letters and its place in the year's archive; what it stops
     doing is asking anybody for work. */
  var EVENT_STATUSES = ['Upcoming', 'Ongoing', 'Completed', 'Cancelled', 'Archived'];

  /* ---------- units ----------
     The Republic is one National government plus its provinces (the colleges and
     school levels), the Commission on Elections, and the Supreme Court. This list
     mirrors backend/supabase/schema.sql so the same names appear whether the app
     is running offline or against Supabase.

     Nothing outside this list is hard-wired: every screen works from unit ids, so
     the names, codes and the roster itself can be edited in Settings without
     touching code. */
  var UNIT_KINDS = ['national', 'province', 'comelec', 'judiciary', 'branch'];
  var UNIT_KIND_RANK = { national: 0, province: 1, comelec: 2, judiciary: 3, branch: 4 };
  var UNIT_KIND_LABEL = {
    national: 'National', province: 'Province', comelec: 'COMELEC',
    judiciary: 'Judiciary', branch: 'Independent body'
  };

  /* Independent bodies run their own tracker and answer to nobody day to day.
     The National government cannot see their tasks, their events or how far along
     they are — only the accomplishment report they file at the end of the term.
     That is a rule of the Republic, so it lives here rather than in a screen. */
  var INDEPENDENT_KINDS = ['comelec', 'judiciary', 'branch'];

  function isIndependent(unitOrId) {
    var u = typeof unitOrId === 'string' ? unit(unitOrId) : unitOrId;
    return !!u && INDEPENDENT_KINDS.indexOf(u.kind) >= 0;
  }

  /* What the header calls this tracker for whoever is signed in. Everyone works
     inside one unit, so the name of that unit is the name of the tracker. */
  function trackerName(unitOrId) {
    var u = typeof unitOrId === 'string' ? unit(unitOrId) : unitOrId;
    if (!u) return 'FCUSR';
    if (u.trackerName) return u.trackerName;
    if (u.kind === 'national') return 'FCUSR Nationals';
    return 'FCUSR ' + (u.code || u.name);
  }

  function trackerTitle(unitId) {
    var u = unit(unitId) || nationalUnit();
    return trackerName(u) + ' Task Tracker';
  }

  /* kind, code, full name, and the name that goes in the header.

     The header name is held per unit rather than worked out from the kind,
     because the council does not follow one rule: the Commission is "FCU
     COMELEC" while the Judiciary is "FCUSR Judiciary". Every one of these is
     editable in Settings → Units, so a change of wording never needs a
     developer. */
  var DEFAULT_UNITS = [
    ['national',  'NAT',     'FCUSR Nationals',                              'FCUSR Nationals'],
    ['province',  'CAS',     'College of Arts and Sciences',                 'FCUSR CAS'],
    ['province',  'CBA',     'College of Business and Accountancy',          'FCUSR CBA'],
    ['province',  'CCJE',    'College of Criminal Justice Education',        'FCUSR CCJE'],
    ['province',  'CTE',     'College of Teacher Education',                 'FCUSR CTE'],
    ['province',  'COE',     'College of Engineering',                       'FCUSR COE'],
    ['province',  'CN',      'College of Nursing',                           'FCUSR CN'],
    ['province',  'CHTM',    'College of Hospitality and Tourism Management', 'FCUSR CHTM'],
    ['province',  'CCS',     'College of Computer Studies',                  'FCUSR CCS'],
    ['province',  'GS',      'Graduate School',                              'FCUSR GS'],
    ['province',  'SHS',     'Senior High School',                           'FCUSR SHS'],
    ['province',  'JHS',     'Junior High School',                           'FCUSR JHS'],
    ['province',  'ELEM',    'Elementary',                                   'FCUSR Elementary'],
    ['comelec',   'COMELEC', 'Commission on Elections',                      'FCU COMELEC'],
    ['judiciary', 'SC',      'Supreme Court',                                'FCUSR Judiciary'],
    ['branch',    'DUAG',    'DUAG Film Festival',                           'FCUSR DUAG Film Festival']
  ];

  /* The posts the 2022 Revised FCUSR Constitution and By-Laws actually creates,
     in the order the document sets them out: the Executive and its cabinet
     (Art. VI), the two houses of Congress (Art. V), the Supreme Court (Art.
     VII), and the local governments (Art. VIII).

     A position is a label printed on reports and nothing more — no line here
     grants anybody anything, which is decided by unit and access. It is a list
     of suggestions, not a closed set: the field takes a typed answer too,
     because a council invents working titles the constitution never named and
     an officer should not have to pick the nearest wrong one. */
  var DEFAULT_POSITIONS = [
    // Executive
    'President', 'Vice President', 'Executive Secretary',
    'Secretary, Budget', 'Secretary, Peace and Order',
    'Secretary, Press and Public Relations', 'Secretary, General Services',
    'Secretary, Sports', 'Secretary, Health', 'Secretary, Students\u2019 Rights',
    'Secretary, Religious Affairs', 'Secretary, Socio-Cultural',
    // Congress — Senate
    'Senate President', 'Senator', 'Senate Secretary',
    'Majority Floor Leader', 'Minority Floor Leader',
    // Congress — House of Representatives
    'Speaker of the House', 'Deputy Speaker', 'House Representative',
    'Secretary General',
    // Judiciary
    'Chief Justice', 'Associate Justice', 'State Prosecutor', 'State Defender',
    'Clerk of Court',
    // Local government — province
    'Governor', 'Vice Governor', 'Provincial Board Member', 'Provincial Administrator',
    // Local government — municipality
    'Mayor', 'Vice Mayor', 'Councilor', 'Municipal Administrator'
  ];

  /* The legislative committees named in Art. V Sec. 9, plus the departments a
     Provincial Board may create under Art. VIII Sec. 7(f). */
  var DEFAULT_COMMITTEES = [
    'Discipline', 'Socio-Cultural', 'Budget and Finance', 'Religious',
    'Sports and Recreational Activities', 'Health',
    'Media Technology and Documentation', 'Justice', 'Local Government Unit',
    'Education', 'Secretariat', 'Finance', 'Creatives', 'Internal Affairs'
  ];

  // Letterhead details, printed at the top of every report. `emblem` is a data URL
  // uploaded in Settings — the slot for the FCU seal / FCUSR triangle.
  var DEFAULT_ORG = {
    name: 'FILAMER CHRISTIAN UNIVERSITY STUDENT REPUBLIC',
    address: 'Roxas Avenue, Roxas City, Capiz 5800',
    email: 'fcusrnational2026@gmail.com',
    emblem: '',
    /* Blank means the letterhead that ships with the app. A replacement is held
       here as a data URL, with who changed it and when — a new letterhead
       changes every report the council files, so it is not an anonymous edit. */
    letterhead: '', letterheadBy: '', letterheadAt: ''
  };

  var state = null;
  var listeners = [];

  /* ---------- persistence ---------- */

  /* The starting roster of units. Called for a fresh install and whenever saved
     data turns out to carry none — the app is never without somewhere to file work. */
  /* Bumped whenever DEFAULT_UNITS gains an entry. A device that was set up
     before the change gets the new units added once, and once only — so a unit
     somebody deliberately removed does not reappear at every load. */
  var UNIT_SEED_VERSION = 2;

  /* When the seeded units and offices are dated.

     Not "now". They are the same sixteen colleges and the same fifteen desks on
     every device, written into this file rather than authored by anybody — so
     stamping them with the moment a phone happened to be opened claims an
     edit that never happened, and gives every device a different date for the
     identical thing.

     That is not tidiness. Merging is last-write-wins on this stamp, and it is
     strictly-greater, so a college renamed on the President's phone at the same
     millisecond as another phone's first visit was judged "not newer" and
     thrown away. It cost that rename silently, and it is why the sync suite
     failed about one run in ten on nothing but timing.

     A fixed date behind any real use means an edit always wins, and two devices
     that have never been touched agree exactly. */
  var SEEDED_AT = '2020-01-01T00:00:00.000Z';

  function seedUnits() {
    return DEFAULT_UNITS.map(function (u) {
      return {
        id: 'unit-' + u[1].toLowerCase(),
        kind: u[0], code: u[1], name: u[2], trackerName: u[3], active: true,
        createdAt: SEEDED_AT, updatedAt: SEEDED_AT
      };
    });
  }

  function blank() {
    return {
      version: 1,
      units: seedUnits(),
      unitsSeed: UNIT_SEED_VERSION,
      offices: seedOffices(),
      officesSeed: OFFICE_SEED_VERSION,
      term: blankTerm(),
      people: [], events: [], tasks: [], reports: [], letters: [],
      /* The Bulletin Board, who has read what on it, and the event templates a
         unit reuses. Three collections like the others: they sync the same way
         and are cleaned the same way on the way in. */
      announcements: [], acks: [], templates: [],
      /* Academic years that have been closed and archived. The current year is
         never stored — it is whatever comes after the last archived one — so
         there is nothing to fall out of step with. Council setup, like the
         letterhead: it travels in the council row. */
      years: [],
      yearStartMonth: 6,
      /* What has been deleted, and when. A row removed on one phone has to stay
         removed: without this the next device to sync sees it missing from the
         server, decides the server is behind, and puts it back. */
      deleted: {},
      /* Where syncing got to. `pulled` is the server clock of the newest change
         this device has taken in; asking for anything newer than that is the
         whole of the pull. */
      sync: { pulled: '', pulledDeletions: '', pushed: '', at: '', unitMap: {}, officeMap: {} },
      positions: DEFAULT_POSITIONS.slice(),
      committees: DEFAULT_COMMITTEES.slice(),
      org: JSON.parse(JSON.stringify(DEFAULT_ORG)),
      councilAt: '',
      seeded: false
    };
  }

  function load() {
    var raw = null;
    try { raw = global.localStorage.getItem(KEY); } catch (e) { raw = null; }
    if (!raw) {
      state = blank();
      /* Empty. The tracker used to open on an invented council — nine
         activities, sixteen officers, a closing date next month — so that the
         end of term could be walked through before it mattered. It was a good
         idea and it went wrong in the field: every device seeded its own copy
         with its own ids, syncing merged them, and officers opened the app onto
         three of everything and a closing date nobody had set. The rehearsal is
         a fixture the tests ask for now, not something the council is given. */
      save();
      return;
    }
    try {
      var parsed = JSON.parse(raw);
      state = normalize(parsed);
    } catch (e) {
      console.warn('Saved data could not be read; starting fresh.', e);
      state = blank();
    }
  }

  /* ---------- sanitising ----------
     Anything arriving from localStorage or a restored backup file is untrusted:
     the file may have been edited by hand or come from someone else. Every value
     is coerced to the shape the app expects before it is allowed into state, so a
     crafted file cannot smuggle markup into an id or a bogus value into an enum. */

  var LIMITS = { name: 80, role: 60, title: 200, text: 1000, reason: 300, org: 200 };

  function str(v, max) {
    if (typeof v !== 'string') {
      if (typeof v === 'number' && isFinite(v)) v = String(v);
      else return '';
    }
    // Strip control characters, then clamp.
    return v.replace(/[\u0000-\u001F\u007F]/g, '').slice(0, max).trim();
  }

  function id(v, prefix) {
    // Ids end up inside HTML attributes and selectors, so they are strictly shaped.
    return (typeof v === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(v)) ? v : U.uid(prefix);
  }

  function oneOf(v, allowed, fallback) {
    return allowed.indexOf(v) >= 0 ? v : fallback;
  }

  function dateOnly(v) {
    if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return '';
    var d = U.parse(v);
    if (!d) return '';
    // Reject impossible dates that still match the pattern, e.g. 2026-02-31.
    return d.toISOString().slice(0, 10) === v ? v : '';
  }

  function stamp(v) {
    if (typeof v !== 'string') return nowISO();
    var d = new Date(v);
    return isNaN(d.getTime()) ? nowISO() : d.toISOString();
  }

  // Only real raster data URLs may be rendered or printed. This blocks
  // javascript:, external URLs, and SVG (which can carry script).
  function emblem(v) {
    if (typeof v !== 'string') return '';
    if (!/^data:image\/(png|jpe?g);base64,[A-Za-z0-9+/=\s]+$/.test(v)) return '';
    return v.length > 1400000 ? '' : v;
  }

  /* A replacement letterhead for the accomplishment report. Bigger than the
     emblem because it is a full A4 sheet, and still capped: this lives in
     localStorage alongside everything else, and that has about five megabytes
     in total. */
  function letterhead(v) {
    if (typeof v !== 'string') return '';
    if (!/^data:image\/(png|jpe?g);base64,[A-Za-z0-9+/=\s]+$/.test(v)) return '';
    return v.length > 3000000 ? '' : v;
  }

  function email(v) {
    var t = str(v, 160).toLowerCase();
    return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(t) ? t : '';
  }

  /* ---------- fields this version has never heard of ----------

     Every clean function above builds a fresh object out of the fields it
     knows, which is what makes a record from a backup, a hostile file or a
     future version safe to hold. It also silently threw away anything it did
     not recognise, and that is what broke syncing every time a feature landed.

     A phone still running last week's build pulls an activity carrying a
     volunteer code, cleans it, keeps everything except the code — and then
     offers the record back on its next full round and writes the code out of
     the council's database for everybody. Nobody sees an error. Both phones
     say Synced. One of them is simply missing a field, for good.

     So an unknown field is carried rather than dropped. It is never trusted:
     it cannot overwrite anything this version validates, because it is only
     written where the clean object has no opinion. It is capped, because this
     all lives in five megabytes of localStorage and a field somebody invents
     should not be able to fill it.

     The server does the same thing from the other side (sync3.sql merges a
     stored body with an arriving one), so an old phone cannot strip a field
     even if it is running a build from before this line was written. */
  var EXTRA_KEYS = 40;
  var EXTRA_CHARS = 20000;

  function keepExtras(raw, clean) {
    if (!raw || typeof raw !== 'object' || !clean) return clean;
    var kept = 0;
    var keys = Object.keys(raw);
    for (var i = 0; i < keys.length && kept < EXTRA_KEYS; i++) {
      var k = keys[i];
      if (Object.prototype.hasOwnProperty.call(clean, k)) continue;
      if (!/^[A-Za-z][A-Za-z0-9_]{0,40}$/.test(k)) continue;
      var v = raw[k];
      if (v === null || v === undefined || typeof v === 'function') continue;
      if (typeof v === 'object') {
        var size = 0;
        try { size = JSON.stringify(v).length; } catch (e) { continue; }
        if (!size || size > EXTRA_CHARS) continue;
      } else if (typeof v === 'string' && v.length > EXTRA_CHARS) {
        continue;
      }
      clean[k] = v;
      kept++;
    }
    return clean;
  }

  /* ---------- activity history ----------

     "Arron created this event · Sep 2". Kept on the record it describes, so it
     travels with it through syncing and needs nothing new on the server — and
     so deleting the record takes its history with it, which is the honest
     answer for something that no longer exists.

     Each line is already a sentence, written when the thing happened, because
     that is the only moment the names in it are certain: the task may be
     renamed and the person may leave, and the line should still say what was
     true then. Capped, because a task that changes hands every week should not
     be able to fill a phone. */
  var HISTORY_CAP = { event: 40, task: 12, announcement: 20, person: 12, template: 12 };

  function cleanHistory(v, cap) {
    if (!Array.isArray(v)) return [];
    return v.slice(-(cap || 20)).map(function (h) {
      if (!h || typeof h !== 'object') return null;
      var text = str(h.text, 240);
      if (!text) return null;
      return { at: stamp(h.at), by: str(h.by, LIMITS.name), text: text };
    }).filter(Boolean);
  }

  function cleanPerson(p) {
    if (!p || typeof p !== 'object') return null;
    var name = str(p.name, LIMITS.name);
    if (!name) return null;
    return keepExtras(p, {
      id: id(p.id, 'per'),
      name: name,
      position: str(p.position, LIMITS.role),
      committee: str(p.committee, LIMITS.role),
      /* The directory is also the record of who was enrolled and for what. A
         person's access and unit are decisions an officer made; the position
         beside them is a label. */
      email: email(p.email),
      unitId: typeof p.unitId === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(p.unitId) ? p.unitId : '',
      access: oneOf(p.access, ['officer', 'volunteer'], 'officer'),
      eventIds: (Array.isArray(p.eventIds) ? p.eventIds : []).filter(function (x) {
        return typeof x === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(x);
      }).slice(0, 200),
      // True once they have set a password and can actually sign in.
      claimed: !!p.claimed,
      /* The head of their unit: a Governor, or the Vice Governor who stands in.
         It is what opens their own council's settings to them, and nothing
         else — so it is the National government's to set. */
      isHead: !!p.isHead,
      active: p.active !== false,
      sample: !!p.sample,
      history: cleanHistory(p.history, HISTORY_CAP.person),
      createdAt: stamp(p.createdAt),
      updatedAt: stamp(p.updatedAt)
    });
  }

  function cleanUnit(u) {
    if (!u || typeof u !== 'object') return null;
    var name = str(u.name, LIMITS.org);
    if (!name) return null;
    return keepExtras(u, {
      id: id(u.id, 'unt'),
      kind: oneOf(u.kind, UNIT_KINDS, 'province'),
      // A code is printed on reports and used nowhere as a key, so it is simply
      // clamped to the shape a code can take.
      code: str(u.code, 16).toUpperCase().replace(/[^A-Z0-9-]/g, ''),
      name: name,
      // What the header calls this tracker. Blank falls back to a sensible
      // reading of the unit, so data saved before this existed still shows a name.
      trackerName: str(u.trackerName, LIMITS.org),
      /* A unit's own letter template. Blank means it uses the Republic's, which
         is what almost every unit does — a college that has its own letterhead
         puts it here and its reports are printed on that instead. */
      letterhead: letterhead(u.letterhead),
      letterheadBy: str(u.letterheadBy, LIMITS.name),
      letterheadAt: u.letterheadAt ? stamp(u.letterheadAt) : '',
      active: u.active !== false,
      createdAt: stamp(u.createdAt),
      updatedAt: stamp(u.updatedAt)
    });
  }

  /* A feedback form is a Google Form, which comes in two shapes: the long
     docs.google.com/forms address and the forms.gle short link people actually
     share. Both are accepted; nothing else is. */
  function formLink(v) {
    if (typeof v !== 'string' || !v) return '';
    var t = v.trim().slice(0, 500);
    return /^https:\/\/(docs\.google\.com\/forms\/|forms\.gle\/)[^\s]*$/.test(t) ? t : '';
  }

  function cleanEvent(e) {
    if (!e || typeof e !== 'object') return null;
    var title = str(e.title, LIMITS.title);
    if (!title) return null;
    var start = dateOnly(e.dateStart);
    var end = dateOnly(e.dateEnd);
    return keepExtras(e, {
      id: id(e.id, 'evt'),
      // Which unit's activity this is. Checked against the roster in normalize(),
      // so a backup naming a unit that no longer exists cannot orphan an event.
      unitId: typeof e.unitId === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(e.unitId) ? e.unitId : '',
      /* An activity, or a directive that holds several tasks.

         A directive used to be a single task and nothing more, which was enough
         for "chase the adviser about the memo" and not enough for "prepare the
         general assembly", where one instruction is six errands with six
         different people on them. A directive with tasks is the same shape as
         an activity — a title, a unit, a list of work — minus the one thing
         that makes an activity an activity: nobody files an accomplishment
         report on a directive. Sharing the record means it also shares syncing,
         separation and every screen that draws a list of tasks. */
      kind: oneOf(e.kind, ['event', 'directive'], 'event'),
      title: title,
      description: str(e.description, LIMITS.text),
      dateStart: start,
      dateEnd: end && start && end >= start ? end : '',
      venue: str(e.venue, LIMITS.title),
      headId: typeof e.headId === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(e.headId) ? e.headId : '',
      status: oneOf(e.status, EVENT_STATUSES, 'Upcoming'),

      /* Why it was called off, and whether the council means to hold it later.
         A cancellation with no reason is a gap somebody has to ask about at the
         end of the term, so the reason is asked for when it is still fresh. */
      /* The code a volunteer types at the door to join this activity. Held on
         the activity itself, so it travels with it and ends with it. */
      volunteerCode: str(e.volunteerCode, 24).toUpperCase().replace(/[^A-Z0-9-]/g, ''),
      volunteerCodeAt: e.volunteerCodeAt ? stamp(e.volunteerCodeAt) : '',

      cancelReason: str(e.cancelReason, LIMITS.reason),
      cancelledBy: str(e.cancelledBy, LIMITS.name),
      cancelledAt: e.cancelledAt ? stamp(e.cancelledAt) : '',
      rescheduleWanted: !!e.rescheduleWanted,
      rescheduleDate: dateOnly(e.rescheduleDate),

      /* Every activity gathers feedback. That is the standing rule, so it is the
         default rather than something to remember to switch on — an activity
         saved before this existed, or by a client that knows nothing about it,
         still comes back requiring one.

         It can be waived, because not every activity can sensibly be evaluated,
         but a waiver is a departure from the standard and is recorded as one:
         who, when, and why. */
      feedbackRequired: e.feedbackRequired !== false,
      feedbackLink: formLink(e.feedbackLink),
      feedbackWaivedBy: str(e.feedbackWaivedBy, LIMITS.name),
      feedbackWaivedReason: str(e.feedbackWaivedReason, LIMITS.reason),
      feedbackWaivedAt: e.feedbackWaivedAt ? stamp(e.feedbackWaivedAt) : '',

      sample: !!e.sample,
      history: cleanHistory(e.history, HISTORY_CAP.event),
      createdAt: stamp(e.createdAt),
      updatedAt: stamp(e.updatedAt)
    });
  }

  // Statuses that have been renamed since. Without this, older saved data and
  // older backup files would quietly fall back to "Not Started" and lose meaning.
  var STATUS_ALIASES = { 'Blocked': 'On hold', 'Waiting': 'On hold', 'Pending': 'Not Started' };

  function cleanTask(t) {
    if (!t || typeof t !== 'object') return null;
    var title = str(t.title, LIMITS.title);
    if (!title) return null;
    var raw = STATUS_ALIASES[t.status] || t.status;
    var status = oneOf(raw, STATUSES, 'Not Started');
    var kind = oneOf(t.kind, ['event', 'directive'], 'event');
    return keepExtras(t, {
      id: id(t.id, 'tsk'),
      kind: kind,
      unitId: id(t.unitId),
      /* A directive has no activity. Editing one used to file it under the first
         activity in the list; those are put back where they belong here. */
      eventId: kind !== 'directive' && typeof t.eventId === 'string' ? t.eventId : '',
      title: title,
      remarks: str(t.remarks, LIMITS.text),
      assigneeId: typeof t.assigneeId === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(t.assigneeId) ? t.assigneeId : '',
      dueDate: dateOnly(t.dueDate),
      priority: oneOf(t.priority, PRIORITIES, 'Medium'),
      status: status,
      blockedReason: status === 'On hold' ? str(t.blockedReason, LIMITS.reason) : '',
      completedAt: status === 'Done' ? (t.completedAt ? stamp(t.completedAt) : nowISO()) : '',
      sample: !!t.sample,
      history: cleanHistory(t.history, HISTORY_CAP.task),
      createdAt: stamp(t.createdAt),
      updatedAt: stamp(t.updatedAt)
    });
  }

  /* ---------- the Bulletin Board ----------

     Official announcements from FCUSR Nationals. One record per announcement,
     read by everybody it is addressed to; the notification that tells somebody
     about it and the preview on the Overview both point at this record rather
     than copying it, so there is only ever one thing to edit or delete. */
  var BULLETIN_PRIORITIES = ['Normal', 'Important', 'Urgent'];
  var AUDIENCE_KINDS = ['everyone', 'nationals', 'units', 'people'];

  function idList(v, max) {
    return (Array.isArray(v) ? v : []).filter(function (x) {
      return typeof x === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(x);
    }).slice(0, max || 200);
  }

  /* A link on an announcement: somewhere on the web over https, or a place in
     this tracker (#/events/…). Nothing else — not javascript:, not http. */
  function announcementLink(v) {
    if (!v || typeof v !== 'object') return { url: '', label: '' };
    var url = typeof v.url === 'string' ? v.url.trim().slice(0, 500) : '';
    var ok = /^https:\/\/[^\s"'<>]{3,}$/.test(url) || /^#\/[A-Za-z0-9\/_-]{1,160}$/.test(url);
    return { url: ok ? url : '', label: ok ? str(v.label, 80) : '' };
  }

  function cleanAnnouncement(a) {
    if (!a || typeof a !== 'object') return null;
    var title = str(a.title, LIMITS.title);
    if (!title) return null;
    var aud = a.audience && typeof a.audience === 'object' ? a.audience : {};
    return keepExtras(a, {
      id: id(a.id, 'ann'),
      // The unit that published it — the National government, in practice.
      unitId: typeof a.unitId === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(a.unitId) ? a.unitId : '',
      title: title,
      // Kept as typed. Line breaks are the whole of its formatting.
      message: typeof a.message === 'string'
        ? a.message.replace(/[\u0000-\u0009\u000B-\u001F\u007F]/g, '').slice(0, 4000).trim() : '',
      audience: {
        kind: oneOf(aud.kind, AUDIENCE_KINDS, 'everyone'),
        unitIds: idList(aud.unitIds, 40),
        personIds: idList(aud.personIds, 400)
      },
      priority: oneOf(a.priority, BULLETIN_PRIORITIES, 'Normal'),
      /* A draft is seen by the National officers and nobody else. Publishing is
         a separate act from writing, so something half-written never goes out
         by accident. */
      published: a.published !== false,
      publishAt: a.publishAt ? stamp(a.publishAt) : '',
      expiresAt: a.expiresAt ? stamp(a.expiresAt) : '',
      link: announcementLink(a.link),
      pinned: !!a.pinned,
      requireAck: !!a.requireAck,
      createdBy: str(a.createdBy, LIMITS.name),
      history: cleanHistory(a.history, HISTORY_CAP.announcement),
      createdAt: stamp(a.createdAt),
      updatedAt: stamp(a.updatedAt)
    });
  }

  /* One person saying they have read one announcement. Keyed by the pair, so
     pressing it on two phones is still one acknowledgement. */
  function cleanAck(k) {
    if (!k || typeof k !== 'object') return null;
    var ann = typeof k.announcementId === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(k.announcementId)
      ? k.announcementId : '';
    var who = str(k.profileId, 64);
    if (!ann || !who) return null;
    return keepExtras(k, {
      id: U.isUuid(k.id) ? k.id : U.hashUuid(ann + '|' + who),
      announcementId: ann,
      profileId: who,
      email: email(k.email),
      name: str(k.name, LIMITS.name),
      at: stamp(k.at),
      createdAt: stamp(k.createdAt),
      updatedAt: stamp(k.updatedAt)
    });
  }

  /* ---------- event templates ----------

     A Seminar, a General Assembly, a Competition: the same dozen errands every
     time, typed out afresh by whoever is organising it this year. A template is
     that list, kept, with when each one usually falls relative to the day. */
  function cleanTemplateTask(x) {
    if (!x || typeof x !== 'object') return null;
    var title = str(x.title, LIMITS.title);
    if (!title) return null;
    var off = Math.round(Number(x.offsetDays));
    return {
      title: title,
      offsetDays: isFinite(off) ? Math.max(-365, Math.min(365, off)) : 0,
      priority: oneOf(x.priority, PRIORITIES, 'Medium')
    };
  }

  function cleanTemplate(t) {
    if (!t || typeof t !== 'object') return null;
    var name = str(t.name, LIMITS.name);
    if (!name) return null;
    var days = Math.round(Number(t.durationDays));
    return keepExtras(t, {
      id: id(t.id, 'tpl'),
      unitId: typeof t.unitId === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(t.unitId) ? t.unitId : '',
      /* Who may use it: the unit that made it, or every unit in the Republic.
         Only the National government shares one Republic-wide. */
      shared: !!t.shared,
      name: name,
      description: str(t.description, LIMITS.text),
      venue: str(t.venue, LIMITS.title),
      durationDays: isFinite(days) && days > 0 && days <= 30 ? days : 1,
      feedbackRequired: t.feedbackRequired !== false,
      volunteers: !!t.volunteers,
      tasks: (Array.isArray(t.tasks) ? t.tasks : []).slice(0, 60).map(cleanTemplateTask).filter(Boolean),
      archived: !!t.archived,
      createdBy: str(t.createdBy, LIMITS.name),
      history: cleanHistory(t.history, HISTORY_CAP.template),
      createdAt: stamp(t.createdAt),
      updatedAt: stamp(t.updatedAt)
    });
  }

  /* ---------- academic years ----------

     A closed year, kept readable. Its records are not moved or copied: an
     activity belongs to the year its date falls in, so marking a year archived
     is enough to take its work off the current screens and make it read-only.
     `start` is blank for the first year ever archived, which reaches back to
     the beginning so nothing older is left stranded as "current". */
  function cleanYears(arr) {
    if (!Array.isArray(arr)) return [];
    var seen = {};
    return arr.slice(0, 60).map(function (y) {
      if (!y || typeof y !== 'object') return null;
      var end = dateOnly(y.end);
      if (!end || seen[end]) return null;
      seen[end] = true;
      var start = dateOnly(y.start);
      return {
        id: 'ay-' + end,
        start: start && start <= end ? start : '',
        end: end,
        label: str(y.label, 40) || yearLabel(start, end),
        note: str(y.note, LIMITS.reason),
        archivedAt: y.archivedAt ? stamp(y.archivedAt) : '',
        archivedBy: str(y.archivedBy, LIMITS.name),
        /* Opened for corrections by the President, for a set time. Blank or in
           the past means read-only. */
        unlockedUntil: y.unlockedUntil ? stamp(y.unlockedUntil) : '',
        unlockedBy: str(y.unlockedBy, LIMITS.name)
      };
    }).filter(Boolean).sort(function (a, b) { return a.end < b.end ? -1 : 1; });
  }

  // "2025–2026", from the dates rather than typed, so it can never disagree with them.
  function yearLabel(start, end) {
    var e = U.parse(end);
    if (!e) return 'Academic year';
    var from = U.parse(start) || U.parse(U.addDays(end, -364));
    var a = from.getUTCFullYear(), b = e.getUTCFullYear();
    return a === b ? String(b) : a + '–' + b;
  }

  function assetIds(v) {
    if (!Array.isArray(v)) return [];
    return v.filter(function (x) {
      return typeof x === 'string' && /^[A-Za-z0-9_:-]{1,96}$/.test(x);
    }).slice(0, 60);
  }

  // A Drive link is the only URL the app ever stores, so it is checked strictly.
  function driveLink(v) {
    if (typeof v !== 'string' || !v) return '';
    var t = v.trim().slice(0, 500);
    return /^https:\/\/(drive|docs)\.google\.com\/[^\s]*$/.test(t) ? t : '';
  }

  function cleanReport(r) {
    if (!r || typeof r !== 'object') return null;
    var minutesMode = oneOf(r.minutes && r.minutes.mode, ['tasks', 'upload', 'skip'], 'tasks');
    return keepExtras(r, {
      id: id(r.id, 'rep'),
      eventId: typeof r.eventId === 'string' ? r.eventId : '',
      description: str(r.description, 4000),
      program: { assets: assetIds(r.program && r.program.assets) },
      photos: (Array.isArray(r.photos) ? r.photos : []).slice(0, 60).map(function (p) {
        return {
          assetId: (typeof p.assetId === 'string' && /^[A-Za-z0-9_:-]{1,96}$/.test(p.assetId)) ? p.assetId : '',
          caption: str(p && p.caption, 200)
        };
      }).filter(function (p) { return p.assetId; }),
      letters: (Array.isArray(r.letters) ? r.letters : []).slice(0, 40).map(function (l) {
        return { name: str(l && l.name, 160), assets: assetIds(l && l.assets) };
      }).filter(function (l) { return l.assets.length; }),
      minutes: { mode: minutesMode, assets: assetIds(r.minutes && r.minutes.assets) },
      liquidation: { assets: assetIds(r.liquidation && r.liquidation.assets) },
      signatories: {
        preparedBy: {
          name: str(r.signatories && r.signatories.preparedBy && r.signatories.preparedBy.name, LIMITS.name),
          position: str(r.signatories && r.signatories.preparedBy && r.signatories.preparedBy.position, LIMITS.role)
        },
        president: {
          name: str(r.signatories && r.signatories.president && r.signatories.president.name, LIMITS.name),
          show: !(r.signatories && r.signatories.president && r.signatories.president.show === false)
        },
        adviser: {
          name: str(r.signatories && r.signatories.adviser && r.signatories.adviser.name, LIMITS.name)
        },
        /* Anyone else who has to sign. The three fixed slots cover the usual
           case; a joint activity, a co-adviser or a department head does not
           fit them, and a report that cannot name its own signatories is not
           the report the council actually files. */
        others: ((r.signatories && Array.isArray(r.signatories.others)) ? r.signatories.others : [])
          .slice(0, 8).map(function (o) {
            return {
              name: str(o && o.name, LIMITS.name),
              position: str(o && o.position, LIMITS.role)
            };
          }).filter(function (o) { return o.name; })
      },
      evaluation: { assets: assetIds(r.evaluation && r.evaluation.assets) },
      driveLink: driveLink(r.driveLink),
      /* A link is only an archive if the file behind it survives turnover. This
         cannot be checked from the URL — a Shared Drive folder and a personal
         one look identical — so somebody says so on the record instead, and that
         attestation is what the end of term actually requires. */
      driveOwned: !!r.driveOwned,
      driveBy: str(r.driveBy, LIMITS.name),
      driveAt: r.driveAt ? stamp(r.driveAt) : '',
      status: oneOf(r.status, ['draft', 'filed'], 'draft'),
      createdAt: stamp(r.createdAt),
      updatedAt: stamp(r.updatedAt)
    });
  }

  /* ---------- one identity per record, everywhere ----------

     Ids used to be `tsk_mtpg8fm9`: unique on this device and meaningless on any
     other. Sync needs two phones to agree that a task is the same task, and
     Postgres wants a uuid, so ids are uuids now.

     Data saved before that carries the old shape. Rewriting an id means
     rewriting everything that points at it in the same pass — a task's event, a
     report's event, a letter's stops — so it is done here, over the whole state
     at once, where nothing can be missed.

     Units and offices are left alone deliberately. They are reference data
     seeded identically on every device from a fixed code list, and their ids
     (`unit-nat`, `office-dean`) are the same everywhere because of it. They are
     reconciled with the server by code at the first sync instead. */
  function normaliseIds(s) {
    var map = {};
    function keep(rec) {
      if (!rec || U.isUuid(rec.id)) return;
      var fresh = U.uid();
      map[rec.id] = fresh;
      rec.id = fresh;
    }
    s.people.forEach(keep);
    s.events.forEach(keep);
    s.tasks.forEach(keep);
    s.reports.forEach(keep);
    s.letters.forEach(keep);
    s.letters.forEach(function (l) { l.stops.forEach(keep); });

    if (!Object.keys(map).length) return s;
    var to = function (v) { return (v && map[v]) || v; };

    s.events.forEach(function (e) { e.headId = to(e.headId); });
    s.tasks.forEach(function (t) { t.eventId = to(t.eventId); t.assigneeId = to(t.assigneeId); });
    s.reports.forEach(function (r) { r.eventId = to(r.eventId); });
    s.people.forEach(function (p) {
      p.eventIds = (p.eventIds || []).map(to);
    });
    s.letters.forEach(function (l) { l.eventId = to(l.eventId); l.inChargeId = to(l.inChargeId); });

    // Tombstones name records too, and a resurrection is exactly what they exist
    // to prevent — so they are carried across with everything else.
    Object.keys(s.deleted || {}).forEach(function (kind) {
      var moved = {};
      Object.keys(s.deleted[kind]).forEach(function (k) { moved[to(k)] = s.deleted[kind][k]; });
      s.deleted[kind] = moved;
    });
    return s;
  }

  /* Called by the sync layer once it has learnt what the server calls a unit or
     an office. Same job as above, for the two kinds that are keyed by code. */
  function remapIds(map) {
    var to = function (v) { return (v && map[v]) || v; };
    var touched = false;
    Object.keys(map).forEach(function (k) { if (map[k] !== k) touched = true; });
    if (!touched) return false;

    state.units.forEach(function (u) { u.id = to(u.id); });
    state.offices.forEach(function (o) { o.id = to(o.id); });
    state.events.forEach(function (e) { e.unitId = to(e.unitId); });
    state.letters.forEach(function (l) {
      l.unitId = to(l.unitId);
      l.stops.forEach(function (st) { st.officeId = to(st.officeId); });
    });
    state.people.forEach(function (p) { p.unitId = to(p.unitId); });
    /* Directives too. A directive carries a unit of its own, because it has no
       activity to read one through — and that field was added without being
       added here, so it kept the id this device invented while everything around
       it moved to the server's. Pushing one then broke the foreign key, and the
       whole round with it. */
    state.tasks.forEach(function (t) { if (t.unitId) t.unitId = to(t.unitId); });
    commit();
    return true;
  }

  /* ---------- taking in what other devices did ----------

     The rule is last-write-wins, per record, on updatedAt. It is the right rule
     for a council: two officers almost never hold the same task at the same
     minute, and when they do, the later edit is the one that was made knowing
     more. It is not free, and it is worth being plain about the cost — if two
     people do edit one task within the same sync window, the earlier edit is
     replaced rather than merged. Nothing is lost that was not overwritten by a
     person who could see the same screen.

     A deletion beats an edit of the same age, because a record deleted and then
     re-uploaded is the failure people actually notice. */
  var COLLECTIONS = {
    unit:   { list: 'units',   clean: cleanUnit },
    person: { list: 'people',  clean: cleanPerson },
    event:  { list: 'events',  clean: cleanEvent },
    task:   { list: 'tasks',   clean: cleanTask },
    report: { list: 'reports', clean: cleanReport },
    letter: { list: 'letters', clean: cleanLetter },
    office: { list: 'offices', clean: cleanOffice },
    announcement: { list: 'announcements', clean: cleanAnnouncement },
    ack:          { list: 'acks',          clean: cleanAck },
    template:     { list: 'templates',     clean: cleanTemplate }
  };

  function newer(a, b) {
    return String(a || '') > String(b || '');
  }

  /* One record from the server. Returns what happened, which is what lets the
     sync layer report "12 in, 3 out" rather than a spinner that means nothing. */
  function applyRemote(kind, rec) {
    var c = COLLECTIONS[kind];
    if (!c) return 'skipped';
    var clean = c.clean(rec);
    if (!clean || !U.isUuid(clean.id)) return 'skipped';
    /* Somebody's rehearsal, from a version that used to seed one and push it.
       Ignoring it is not enough — it would sit on the server forever, offered to
       every device on every round. Recording it as deleted is what sweeps it
       off, from whichever device happens to see it first. */
    if (clean.sample) {
      tombstone(kind, clean.id);
      return 'skipped';
    }

    // Deleted here since: the server has not heard yet, and will on the push.
    var gone = state.deleted[kind] && state.deleted[kind][clean.id];
    if (gone && !newer(clean.updatedAt, gone)) return 'skipped';
    /* Edited somewhere else AFTER it was deleted here, so it comes back — and
       the tombstone has to go with it. Holding both at once is a device that
       quietly contradicts itself: the record is on screen, and the next full
       round offers the tombstone and the DELETE that goes with it, so the
       revival is undone an hour later and nobody can see why. */
    if (gone) delete state.deleted[kind][clean.id];

    var list = state[c.list];
    for (var i = 0; i < list.length; i++) {
      if (list[i].id !== clean.id) continue;
      if (!newer(clean.updatedAt, list[i].updatedAt)) return 'kept';
      list[i] = clean;
      return 'updated';
    }
    list.push(clean);
    return 'added';
  }

  /* A deletion from another device. */
  function applyRemoteDeletion(kind, rid, at) {
    var c = COLLECTIONS[kind];
    if (!c || !rid) return false;
    var list = state[c.list];
    /* A deletion removes the record. It used to make an exception for a record
       edited here after the deletion happened elsewhere — which sounds kind and
       was wrong twice over. It compared this device's clock against the server's,
       two clocks that must never be compared, so which one won was luck; and a
       record that comes back days later because somebody touched it is the
       failure people actually notice and cannot explain. Deleting is an explicit
       act by a person who could see the thing. It stands. */
    var found = false;
    var removed = null;
    for (var i = 0; i < list.length; i++) {
      if (list[i].id !== rid) continue;
      removed = list[i];
      list.splice(i, 1);
      found = true;
      break;
    }
    /* Pictures live in IndexedDB under the report's id, and they are the only
       large thing this app keeps. Deleting something HERE has always freed
       them; a deletion arriving from another device freed nothing, so an
       activity cleared out by the President left its scans and its eight
       photographs on every other phone in the Republic, for ever, with no
       record of them anywhere to find them by.

       A term of activities is tens of megabytes of that. */
    var orphaned = [];
    if (kind === 'event') {
      state.tasks = state.tasks.filter(function (t) { return t.eventId !== rid; });
      state.reports = state.reports.filter(function (r) {
        if (r.eventId === rid) { orphaned.push(r.id); return false; }
        return true;
      });
      // Same as deleting here. Not bumped: every device arrives at the same
      // answer from the same tombstone, and has nothing to tell anybody.
      state.letters.forEach(function (l) { if (l.eventId === rid) l.eventId = ''; });
    }
    if (kind === 'report' && removed) orphaned.push(removed.id);
    if (orphaned.length && global.AssetDB) {
      orphaned.forEach(function (id) { global.AssetDB.delPrefix(id + ':'); });
    }
    /* The same tidying deletePerson does, because otherwise the two devices show
       different things for ever: the one that pressed the button kept the
       carrier's name on a letter as plain text, and every other one was left
       pointing at somebody who no longer exists and showed no name at all.

       It matters more than it used to. Removing a member is done by the server
       now, so no device performs deletePerson at all — every one of them arrives
       here, and without this the name was simply lost everywhere.

       updatedAt is deliberately not bumped. Every device does this same tidying
       from the same tombstone and lands on the same answer, so there is nothing
       to tell anybody about; bumping would have fifty phones push the same rows
       at each other to say a thing they all already agree on. */
    if (kind === 'person' && found) {
      var gone = removed;
      state.tasks.forEach(function (t) { if (t.assigneeId === rid) t.assigneeId = ''; });
      state.events.forEach(function (e) { if (e.headId === rid) e.headId = ''; });
      state.letters.forEach(function (l) {
        if (l.inChargeId !== rid) return;
        l.inChargeId = '';
        if (!l.inChargeName && gone) l.inChargeName = gone.name;
      });
      if (lastPerson() === rid) setLastPerson('');
    }
    if (!state.deleted[kind]) state.deleted[kind] = {};
    state.deleted[kind][rid] = at || nowISO();
    return found;
  }

  /* Everything this device has that the server may not. Sent whole rather than
     as a diff: a record is small, and a diff is a second source of truth. */
  function outbound(since) {
    var out = { records: {}, deletions: [] };
    Object.keys(COLLECTIONS).forEach(function (kind) {
      out.records[kind] = state[COLLECTIONS[kind].list].filter(function (r) {
        /* The dry run stays on the device that made it. Each device seeds its
           own copy with its own ids, so syncing them merges two rehearsals into
           one and the council sees every invented officer twice. It is a
           rehearsal, not the council's work, and it has no business on a server
           everybody shares. */
        if (r.sample) return false;
        /* Deleted here, and somehow still in the list. It should not happen and
           it did: a record revived by a remote edit used to keep its tombstone,
           and a full round then offered the record and its deletion in the same
           breath. Whichever the server applied last was luck. A record this
           device says is gone is never offered back. */
        if (state.deleted[kind] && state.deleted[kind][r.id]) return false;
        return U.isUuid(r.id) && (!since || newer(r.updatedAt, since));
      });
    });
    Object.keys(state.deleted).forEach(function (kind) {
      Object.keys(state.deleted[kind]).forEach(function (rid) {
        var at = state.deleted[kind][rid];
        if (!since || newer(at, since)) out.deletions.push({ kind: kind, id: rid, at: at });
      });
    });
    return out;
  }

  function syncState() { return state.sync; }

  /* Saved, deliberately without telling anyone.

     `commit()` notifies, the sync layer listens for changes so it can send them,
     and so a sync that ended by committing would schedule the next sync — which
     would end by committing, and so on every few seconds for as long as the app
     is open, on every phone, forever. Nothing here is on screen: where the sync
     got to is bookkeeping, not council work. It is written to disk and no view
     is asked to redraw. */
  /* The closing date as another device declared it. One row, so there is no
     merge to do — the later declaration stands, which is the same rule every
     record follows. */
  function applyRemoteTerm(t) {
    var clean = cleanTerm(t);
    // A withdrawal carries a stamp and no date; a server that has never had a
    // term carries neither, and is the only thing to ignore.
    if (!clean.declaredAt && !clean.updatedAt) return false;
    state.term = clean;
    commit();
    return true;
  }

  /* Forget where syncing got to, so the next round sends everything this device
     holds and takes in everything the server holds.

     Needed because the marks are the one piece of state that can be wrong in a
     way nothing else reveals. A round that failed part-way, a version with a
     bug in it, a device restored from a backup taken after its last sync — any
     of them can leave a device believing it has already sent work it never sent,
     and the symptom is silence: everything looks synced and nobody else has your
     activity. Re-sending is safe because every write is an upsert. */
  function resetSyncMarks(opts) {
    opts = opts || {};
    if (opts.push !== false) state.sync.pushed = '';
    if (opts.pull !== false) { state.sync.pulled = ''; state.sync.pulledDeletions = ''; }
    save();
    return state.sync;
  }

  /* The council's own details as one thing: what is printed at the top of every
     report, the Republic's letter template, and the lists a form offers. Setup
     rather than work, which is why it was left out of the first sync — but "the
     letterhead is on the President's laptop and nowhere else" is exactly the
     disagreement this layer exists to prevent. */
  function council() {
    return {
      org: state.org,
      positions: state.positions,
      committees: state.committees,
      /* Which academic years are closed. Setup of the Republic, like the
         letterhead, so it rides in the same row. A phone on an older build
         does not know these two fields and sends the row without them; the
         server keeps what it is not sent (sync3.sql), so they survive it. */
      years: state.years,
      yearStartMonth: state.yearStartMonth,
      updatedAt: state.councilAt || ''
    };
  }

  function touchCouncil() {
    state.councilAt = bumpStamp(state.councilAt);
  }

  function applyRemoteCouncil(c) {
    if (!c || typeof c !== 'object') return false;
    if (!newer(c.updatedAt || '', state.councilAt || '')) return false;
    if (c.org && typeof c.org === 'object') {
      state.org.name = str(c.org.name, LIMITS.org) || state.org.name;
      state.org.address = str(c.org.address, LIMITS.org);
      state.org.email = str(c.org.email, LIMITS.org);
      state.org.emblem = emblem(c.org.emblem);
      state.org.letterhead = letterhead(c.org.letterhead);
      state.org.letterheadBy = str(c.org.letterheadBy, LIMITS.name);
      state.org.letterheadAt = c.org.letterheadAt ? stamp(c.org.letterheadAt) : '';
    }
    if (Array.isArray(c.positions)) state.positions = cleanList(c.positions, DEFAULT_POSITIONS);
    if (Array.isArray(c.committees)) state.committees = cleanList(c.committees, DEFAULT_COMMITTEES);
    if (Array.isArray(c.years)) state.years = cleanYears(c.years);
    if (c.yearStartMonth !== undefined) state.yearStartMonth = startMonth(c.yearStartMonth);
    state.councilAt = stamp(c.updatedAt) || nowISO();
    commit();
    return true;
  }

  function markSynced(patch) {
    Object.keys(patch || {}).forEach(function (k) { state.sync[k] = patch[k]; });
    save();
  }

  var DELETABLE = ['event', 'task', 'report', 'letter', 'person', 'office', 'unit',
                   'announcement', 'ack', 'template'];

  /* Tombstones age out. A device that has been in a drawer for three months has
     bigger problems than one resurrected task, and keeping every deletion for
     the life of the council would grow without bound. */
  var TOMBSTONE_DAYS = 120;

  function cleanDeleted(d) {
    var out = {};
    if (!d || typeof d !== 'object') return out;
    var cut = U.addDays(U.today(), -TOMBSTONE_DAYS);
    DELETABLE.forEach(function (kind) {
      var src = d[kind];
      if (!src || typeof src !== 'object') return;
      var keep = {};
      Object.keys(src).slice(0, 5000).forEach(function (k) {
        if (!/^[A-Za-z0-9_-]{1,64}$/.test(k)) return;
        var at = stamp(src[k]);
        if (at && at.slice(0, 10) >= cut) keep[k] = at;
      });
      if (Object.keys(keep).length) out[kind] = keep;
    });
    return out;
  }

  function cleanIdMap(m) {
    var out = {};
    if (!m || typeof m !== 'object') return out;
    Object.keys(m).slice(0, 500).forEach(function (k) {
      if (/^[A-Za-z0-9_-]{1,64}$/.test(k) && U.isUuid(m[k])) out[k] = m[k];
    });
    return out;
  }

  /* Recorded at the moment of deletion, so the next sync can say "this was
     removed" rather than the server saying "you are missing one". */
  function tombstone(kind, rid) {
    if (!rid) return;
    if (!state.deleted[kind]) state.deleted[kind] = {};
    /* Always later than the thing it buries.

       A record and the tombstone that buries it are written in the same
       instant, and a phone's clock has only millisecond resolution. A record
       whose stamp had been nudged a tick forward — which bumpStamp does
       whenever two edits land in one millisecond, and a save followed by a
       sync is exactly that — was therefore NEWER than its own tombstone. The
       next round read that as "edited somewhere else after it was deleted",
       and brought it back.

       It cost a deleted activity's report: gone from the screen, still on the
       server, back on the next phone to sync. */
    var c = COLLECTIONS[kind];
    var rec = c && state[c.list] && state[c.list].filter(function (r) { return r.id === rid; })[0];
    state.deleted[kind][rid] = rec ? bumpStamp(rec.updatedAt) : nowISO();
  }

  function deletions() { return state.deleted; }

  function isDeleted(kind, rid) {
    return !!(state.deleted[kind] && state.deleted[kind][rid]);
  }

  // The month an academic year begins in, 1–12. June unless the council says otherwise.
  function startMonth(v) {
    var n = Math.round(Number(v));
    return isFinite(n) && n >= 1 && n <= 12 ? n : 6;
  }

  function cleanList(arr, fallback, max) {
    if (!Array.isArray(arr)) return fallback.slice();
    var seen = {};
    var out = arr.map(function (v) { return str(v, LIMITS.role); }).filter(function (v) {
      if (!v || seen[v.toLowerCase()]) return false;
      seen[v.toLowerCase()] = true;
      return true;
    }).slice(0, max || 60);
    return out.length ? out : fallback.slice();
  }

  function normalize(data) {
    var s = blank();
    if (!data || typeof data !== 'object') return s;

    /* Units are read before anything else, because events are filed under them.
       Duplicates are collapsed and a National unit is guaranteed, so there is
       always somewhere for council-wide work to sit. */
    var seenUnit = {};
    s.units = (Array.isArray(data.units) ? data.units : []).map(cleanUnit)
      .filter(function (u) {
        if (!u || seenUnit[u.id]) return false;
        seenUnit[u.id] = true;
        return true;
      });
    if (!s.units.length) s.units = seedUnits();
    if (!s.units.some(function (u) { return u.kind === 'national'; })) {
      s.units.unshift(seedUnits()[0]);
    }

    /* What is actually in the list now, rather than what arrived in the file.

       seenUnit was built from the saved units alone, and the two lines above
       add units without telling it. So a save with no units list — an old
       backup, a file written before units were stored, anything partial — got
       the sixteen colleges from the seed, and then the top-up below could not
       see them and added all sixteen again. Every college twice, on a device
       that had done nothing wrong.

       Adding a missing National unit had the same shape: unshifted, unrecorded,
       and then pushed a second time. Offices avoid both by topping up only when
       nothing was seeded, which is the same fix said another way. */
    seenUnit = {};
    s.units.forEach(function (u) { seenUnit[u.id] = true; });

    // A device set up before a unit existed is topped up once.
    var seenSeed = typeof data.unitsSeed === 'number' ? data.unitsSeed : 0;
    if (seenSeed < UNIT_SEED_VERSION) {
      seedUnits().forEach(function (u) {
        if (!seenUnit[u.id]) { s.units.push(u); seenUnit[u.id] = true; }
      });
    }
    s.unitsSeed = UNIT_SEED_VERSION;

    s.people = (Array.isArray(data.people) ? data.people : []).map(cleanPerson).filter(Boolean);
    s.events = (Array.isArray(data.events) ? data.events : []).map(cleanEvent).filter(Boolean);
    s.tasks = (Array.isArray(data.tasks) ? data.tasks : []).map(cleanTask).filter(Boolean);
    s.reports = (Array.isArray(data.reports) ? data.reports : []).map(cleanReport).filter(Boolean);
    /* Offices are read before letters, because a letter's trail points at them.
       A device set up before an office existed is topped up once, the same way
       units are. */
    var seenOffice = {};
    s.offices = (Array.isArray(data.offices) ? data.offices : []).map(cleanOffice)
      .filter(function (o) {
        if (!o || seenOffice[o.id]) return false;
        seenOffice[o.id] = true;
        return true;
      });
    if (!s.offices.length) s.offices = seedOffices();
    else if ((typeof data.officesSeed === 'number' ? data.officesSeed : 0) < OFFICE_SEED_VERSION) {
      var byId = {};
      s.offices.forEach(function (o) { byId[o.id] = o; });
      seedOffices().forEach(function (o) {
        if (!seenOffice[o.id]) { s.offices.push(o); seenOffice[o.id] = true; return; }
        /* Already here. The council's wording for its own desks has been
           corrected more than once, and a device that seeded the old wording
           should not be stuck with it — but only where nobody has since made
           the name their own. */
        var have = byId[o.id];
        if (have && have.seededName && have.seededName === have.name && have.name !== o.name) {
          have.name = o.name;
          have.seededName = o.name;
        } else if (have && !have.seededName) {
          have.seededName = have.name;
        }
      });
    }
    s.officesSeed = OFFICE_SEED_VERSION;

    s.letters = (Array.isArray(data.letters) ? data.letters : []).map(cleanLetter).filter(Boolean);

    /* Saved before these existed, the lists are simply empty — nothing to
       migrate, and nothing about an older record changes. */
    s.announcements = (Array.isArray(data.announcements) ? data.announcements : [])
      .map(cleanAnnouncement).filter(Boolean);
    s.acks = (Array.isArray(data.acks) ? data.acks : []).map(cleanAck).filter(Boolean);
    s.templates = (Array.isArray(data.templates) ? data.templates : [])
      .map(cleanTemplate).filter(Boolean);
    s.years = cleanYears(data.years);
    s.yearStartMonth = startMonth(data.yearStartMonth);

    s.term = cleanTerm(data.term);
    s.deleted = cleanDeleted(data.deleted);
    s.sync = {
      pulled: data.sync && typeof data.sync.pulled === 'string' ? stamp(data.sync.pulled) : '',
      /* Tombstones are timed by whoever deleted the thing, on their own watch;
         records are timed by the server on its own. Two clocks, so two marks —
         they were one, and a single phone with a fast watch could push the
         shared mark into the future and quietly stop the whole device
         receiving anything at all. */
      pulledDeletions: data.sync && typeof data.sync.pulledDeletions === 'string' ? stamp(data.sync.pulledDeletions) : '',
      pushed: data.sync && typeof data.sync.pushed === 'string' ? stamp(data.sync.pushed) : '',
      at: data.sync && typeof data.sync.at === 'string' ? stamp(data.sync.at) : '',
      unitMap: cleanIdMap(data.sync && data.sync.unitMap),
      officeMap: cleanIdMap(data.sync && data.sync.officeMap)
    };
    s.councilAt = data.councilAt ? stamp(data.councilAt) : '';
    s.positions = cleanList(data.positions, DEFAULT_POSITIONS);
    s.committees = cleanList(data.committees, DEFAULT_COMMITTEES);
    s.seeded = !!data.seeded;

    if (data.org && typeof data.org === 'object') {
      s.org.name = str(data.org.name, LIMITS.org) || DEFAULT_ORG.name;
      s.org.address = str(data.org.address, LIMITS.org);
      s.org.email = str(data.org.email, LIMITS.org);
      s.org.emblem = emblem(data.org.emblem);
      s.org.letterhead = letterhead(data.org.letterhead);
      s.org.letterheadBy = str(data.org.letterheadBy, LIMITS.name);
      s.org.letterheadAt = data.org.letterheadAt ? stamp(data.org.letterheadAt) : '';
    }

    // Drop references that point nowhere: a task cannot exist outside an event,
    // and an assignee or event head must be someone who actually exists.
    /* An event filed under a unit that is not in the roster — older data saved
       before units existed, or a backup from a different roster — becomes National
       work rather than disappearing. */
    var nat = s.units.filter(function (u) { return u.kind === 'national'; })[0];
    var unitIds = {};
    s.units.forEach(function (u) { unitIds[u.id] = true; });
    s.events.forEach(function (e) { if (!unitIds[e.unitId]) e.unitId = nat.id; });

    var eventIds = {}, personIds = {};
    s.events.forEach(function (e) { eventIds[e.id] = true; });
    s.people.forEach(function (p) { personIds[p.id] = true; });
    s.events.forEach(function (e) { if (!personIds[e.headId]) e.headId = ''; });
    /* A task is kept even when its activity is not on this device.

       This used to drop it, on the reasoning that an activity which is not here
       has been deleted. It is just as often an activity this person may not
       open: a college officer given a task in a National activity, a volunteer
       given one before being attached to it. The server sends them the task and
       not the activity, so the task arrived, showed in My tasks, and was thrown
       away the next time the page was opened — and because the sync had already
       passed it, it did not come back until the next full round, only to be
       thrown away again. Deleting an activity removes its tasks by itself; it
       never needed this. */
    s.tasks = s.tasks.filter(function (t) {
      return t.kind === 'directive' || !!t.eventId;
    });
    s.reports = s.reports.filter(function (r) { return eventIds[r.eventId]; });

    /* A letter whose event is gone becomes council business rather than
       vanishing, and a stop naming an office that no longer exists is dropped.
       A letter left with no route at all is not a letter we can track. */
    var officeIds = {};
    s.offices.forEach(function (o) { officeIds[o.id] = true; });
    s.letters.forEach(function (l) {
      if (l.eventId && !eventIds[l.eventId]) l.eventId = '';
      if (!unitIds[l.unitId]) l.unitId = nat.id;
      if (!personIds[l.inChargeId]) l.inChargeId = '';
      /* An office that has been deleted leaves its stops behind: the letter
         did go there. The name it was called at the time is kept so the trail
         still reads, and only a stop with neither is dropped. */
      l.stops.forEach(function (st) {
        if (st.officeId && !officeIds[st.officeId]) {
          if (!st.label) st.label = 'A former office';
          st.officeId = '';
        }
      });
      l.stops = l.stops.filter(function (st) { return st.officeId || st.label; });
    });
    s.letters = s.letters.filter(function (l) { return l.stops.length > 0; });
    s.tasks.forEach(function (t) { if (!personIds[t.assigneeId]) t.assigneeId = ''; });

    /* The rehearsal, wherever it still is.

       Devices that ran an older version are holding invented activities and
       officers, and some of it reached the server before it was kept off. This
       clears it once, on every device as it updates, and records the deletions
       so it goes from the server and from everybody else too. Nobody has to
       find a button, and it cannot come back: nothing seeds it any more. */
    var sampleEvents = {};
    s.events.forEach(function (e) { if (e.sample) sampleEvents[e.id] = 1; });
    var doomed = function (list, r) {
      if (r.sample) return true;
      // A task or a letter written against an invented activity goes with it.
      return (list !== 'people') && !!r.eventId && !!sampleEvents[r.eventId];
    };

    var KIND = { events: 'event', tasks: 'task', letters: 'letter',
                 people: 'person', reports: 'report' };
    var at = nowISO();
    Object.keys(KIND).forEach(function (list) {
      var going = s[list].filter(function (r) { return doomed(list, r); });
      if (!going.length) return;
      if (!s.deleted[KIND[list]]) s.deleted[KIND[list]] = {};
      going.forEach(function (r) { s.deleted[KIND[list]][r.id] = at; });
      s[list] = s[list].filter(function (r) { return !doomed(list, r); });
    });

    // The closing date the rehearsal invented is not the council's.
    if (s.term && s.term.declaredBy === 'Dry run') s.term = blankTerm();
    delete s.dryRun;

    return normaliseIds(s);
  }

  /* Whether the last attempt to write to this device failed.

     It used to be a toast and nothing else. A toast is gone in four seconds, and
     what follows is an officer working all afternoon on a screen that looks
     perfectly normal — every event added, every task ticked — with none of it
     written down. One refresh and the afternoon is gone, with no warning still
     on screen by the time it mattered.

     So the app is told, and keeps saying so until a save works. */
  var saveBroken = false;

  function storageBroken() { return saveBroken; }

  function save() {
    try {
      global.localStorage.setItem(KEY, JSON.stringify(state));
      if (saveBroken) { saveBroken = false; notify(); }
    } catch (e) {
      if (!saveBroken) {
        saveBroken = true;
        console.error('Could not save to browser storage.', e);
        if (global.UI && global.UI.toast) {
          global.UI.toast('Could not save — browser storage may be full or blocked.', 'error');
        }
        notify();
      }
    }
  }

  function notify() { listeners.forEach(function (fn) { fn(); }); }
  function subscribe(fn) { listeners.push(fn); }

  function commit() { save(); notify(); }

  var nowISO = function () { return new Date().toISOString(); };

  /* A stamp that is always later than the one before it.

     Used on every edit, not only on the singletons it was written for. An edit
     has to be newer than the version it replaces or it is not an edit at all —
     merging asks exactly that question and discards anything that is not. Plain
     "now" cannot promise it: a phone whose clock is corrected backwards, or two
     changes inside one millisecond, both produce an edit that is not newer than
     what it overwrites, and it disappears with nothing said.


     A phone's clock has millisecond resolution, and two changes to the same
     thing inside one millisecond is ordinary — a form saves, a sync fires, a
     second edit lands. Sync compares these stamps with a strict "newer than", so
     two equal ones mean the second change is invisible: it is never sent, and
     never taken in. Not an error anybody sees; just a letterhead that quietly
     does not travel. */
  function bumpStamp(previous) {
    var now = nowISO();
    if (!previous || now > previous) return now;
    return new Date(Date.parse(previous) + 1).toISOString();
  }

  /* ---------- writing the history line ---------- */

  function actorName() {
    var who = global.Auth && Auth.signedIn && Auth.signedIn() ? Auth.current() : null;
    return who && who.name ? who.name : 'Someone';
  }

  /* One line on one record. The same sentence from the same person inside two
     minutes is one event, not two — saving a form twice is not news. */
  function logOn(rec, kind, text) {
    if (!rec || !text) return;
    if (!Array.isArray(rec.history)) rec.history = [];
    var list = rec.history;
    var by = actorName();
    var at = nowISO();
    var last = list[list.length - 1];
    if (last && last.text === text && last.by === by &&
        Date.parse(at) - Date.parse(last.at) < 120000) return;
    list.push({ at: at, by: by, text: str(text, 240) });
    var cap = HISTORY_CAP[kind] || 20;
    if (list.length > cap) list.splice(0, list.length - cap);
  }

  /* ---------- which academic year a record belongs to ----------

     Nothing is stamped with a year. An activity belongs to the year its date
     falls in; its tasks, report and letters belong where it does; a directive
     or a letter on its own by its date or the day it was made. So closing a
     year needs no migration, changes no id and copies nothing — and a record
     with its date corrected simply moves to the year it now falls in. */
  function anchorOf(kind, rec) {
    if (!rec) return '';
    var ev;
    if (kind === 'event') return rec.dateStart || U.dayOf(rec.createdAt);
    if (kind === 'task' || kind === 'letter' || kind === 'report') {
      ev = rec.eventId ? event(rec.eventId) : null;
      if (ev) return anchorOf('event', ev);
      if (kind === 'task') return rec.dueDate || U.dayOf(rec.createdAt);
      return U.dayOf(rec.createdAt);
    }
    if (kind === 'announcement') return U.dayOf(rec.publishAt || rec.createdAt);
    return '';
  }

  function archivedYears() { return state.years.slice(); }

  function archivedYear(yid) {
    for (var i = 0; i < state.years.length; i++) if (state.years[i].id === yid) return state.years[i];
    return null;
  }

  /* The year a date falls in: an archived one's id, or 'current'. */
  function yearOfDate(day) {
    if (!day) return 'current';
    for (var i = 0; i < state.years.length; i++) {
      var y = state.years[i];
      if ((!y.start || day >= y.start) && day <= y.end) return y.id;
    }
    return 'current';
  }

  function yearOf(kind, rec) { return yearOfDate(anchorOf(kind, rec)); }

  /* Where the current year starts when none has ever been archived: the start
     of the academic year the council's own first record was made in. Read off
     when records were made rather than what they are dated, because one
     activity typed in with the wrong year would otherwise pull the whole
     "current year" back with it. */
  function ayStartFor(day) {
    var m = state.yearStartMonth || 6;
    var y = Number(day.slice(0, 4));
    var mon = Number(day.slice(5, 7));
    if (mon < m) y -= 1;
    return y + '-' + (m < 10 ? '0' : '') + m + '-01';
  }

  function firstMade() {
    var first = U.today();
    ['events', 'tasks', 'letters'].forEach(function (list) {
      state[list].forEach(function (r) {
        var d = U.dayOf(r.createdAt);
        if (d && d < first) first = d;
      });
    });
    return first;
  }

  /* The year the council is working in now. Never stored: it is whatever
     follows the last archived year, so nothing can fall out of step with it. */
  function currentYear() {
    var last = state.years[state.years.length - 1];
    var start = last ? U.addDays(last.end, 1) : ayStartFor(firstMade());
    /* To the boundary that ends the academic year it mostly covers. A year
       closed a few weeks early leaves a current year that starts early; it
       still ends where that year ends rather than a few weeks later. */
    var end = U.addDays(ayStartFor(U.addDays(start, 545)), -1);
    return {
      id: 'current', start: start, end: end, label: yearLabel(start, end),
      // Past its end and still open: the President is reminded, nothing more.
      overdue: U.today() > end
    };
  }

  function yearInfo(yid) {
    if (!yid || yid === 'current') return currentYear();
    return archivedYear(yid);
  }

  /* Read-only because its year is archived, and not opened for corrections. */
  function yearLocked(yid) {
    if (!yid || yid === 'current') return false;
    var y = archivedYear(yid);
    if (!y) return false;
    return !(y.unlockedUntil && y.unlockedUntil > nowISO());
  }

  function isLocked(kind, rec) { return !!rec && yearLocked(yearOf(kind, rec)); }

  /* The last line of defence, under every button that could change an archived
     record. The screens hide those buttons; this is what holds if one is
     missed, or a record arrives some other way. */
  function assertOpen(kind, rec) {
    if (!rec || !isLocked(kind, rec)) return;
    var y = archivedYear(yearOf(kind, rec));
    throw new Error('That belongs to AY ' + (y ? y.label : 'an archived year') +
      ', which is archived and read-only. The President can reopen it for corrections.');
  }

  /* ---------- people ---------- */

  function people(opts) {
    opts = opts || {};
    var list = state.people.slice();
    if (opts.activeOnly) list = list.filter(function (p) { return p.active !== false; });
    if (opts.unitId) list = list.filter(function (p) { return p.unitId === opts.unitId; });
    return list.sort(function (a, b) { return a.name.localeCompare(b.name); });
  }

  /* Who may be given a task on this activity.

     Not everybody in the Republic, which is what the picker used to offer: a
     national officer scrolled past every college's roster to find one of their
     own. It is the unit that owns the activity, plus anybody taken on for this
     activity in particular — which is how somebody from a college comes to be
     working on a national event without leaving their college. */
  /* Who this person may hand work to, on this activity.

     It used to be "everybody in the unit that owns the activity", which is right
     for the unit's own people and backwards for everybody else. A college helping
     with a National activity was offered the National government's entire roster
     — the Republic's executives, in a college officer's assignee picker — while
     their own team, the people actually doing the work, were the ones missing.

     A college's phone can still be holding those names from before the database
     was tightened; sync adds and updates and never takes away, so a roster
     downloaded once stays downloaded. Scoping here rather than trusting what
     happens to be on the device is what makes the picker right on a phone that
     has been signed in since before any of that. */
  function assignable(eventId) {
    var e = event(eventId);
    var evUnit = e ? e.unitId : nationalUnitId();
    var myUnit = (global.Auth && Auth.signedIn() && Auth.myUnitId()) || '';
    var national = !!(global.Auth && Auth.isNational && Auth.isNational());

    var seen = {};
    var out = [];
    var add = function (p) {
      if (seen[p.id]) return;
      seen[p.id] = true;
      out.push(p);
    };

    /* Your own people, always. This is the list a college officer wants and the
       one they were not being given. */
    if (myUnit) people({ activeOnly: true, unitId: myUnit }).forEach(add);

    /* The activity's own unit as well — but only for somebody who belongs to it,
       or for the National government, which oversees every unit. Otherwise a
       college is being offered another unit's roster. */
    if (national || !myUnit || evUnit === myUnit) {
      people({ activeOnly: true, unitId: evUnit }).forEach(add);
    }

    // And anybody taken on for this activity in particular, wherever they are from.
    if (eventId) {
      people({ activeOnly: true }).forEach(function (p) {
        if ((p.eventIds || []).indexOf(eventId) >= 0) add(p);
      });
    }
    return out.sort(function (a, b) { return a.name.localeCompare(b.name); });
  }

  function person(id) {
    if (!id) return null;
    for (var i = 0; i < state.people.length; i++) if (state.people[i].id === id) return state.people[i];
    return null;
  }

  function personName(id) {
    var p = person(id);
    return p ? p.name : 'Unassigned';
  }

  /* One person, and the whole store written to disk and the whole app redrawn
     after it. That is the right trade for somebody typing a name into a form.

     It is the wrong trade a hundred and fifty times in a row. A college pasting
     its roster in went through addPerson per line, so a 150-name list meant 150
     full saves and 150 full redraws, each one a little slower than the last
     because the thing being written keeps growing. What that looks like is the
     app hanging on the one screen built for doing a lot at once. */
  /* One address, one person.

     My tasks finds the signed-in person by the address their account was made
     with, and an account is made per address. Two directory entries sharing one
     meant the second entry's tasks never appeared on that person's My tasks —
     silently, and permanently. The directory accepted it from the form, from an
     edit, and from a pasted roster containing somebody already there. */
  function emailTaken(addr, exceptId) {
    var want = email(addr);
    if (!want) return null;
    for (var i = 0; i < state.people.length; i++) {
      var q = state.people[i];
      if (q.id !== exceptId && q.email === want) return q;
    }
    return null;
  }

  function addPeople(list) {
    var made = [];
    var seen = {};
    (list || []).forEach(function (data) {
      var p = buildPerson(data);
      if (!p) return;
      // Somebody already in the directory, or twice in the same paste.
      if (p.email && (emailTaken(p.email) || seen[p.email])) return;
      if (p.email) seen[p.email] = true;
      state.people.push(p);
      made.push(p);
    });
    if (made.length) commit();
    return made;
  }

  function buildPerson(data) {
    return cleanPerson({
      id: U.uid('per'),
      name: data.name, position: data.position, committee: data.committee,
      /* Whoever is adding them, not the National government by default. That
         default meant an officer enrolled into a college was filed as national,
         so their own Governor could not find them and the national roster filled
         with people who had never been national. */
      email: data.email, isHead: !!data.isHead,
      unitId: data.unitId ||
        ((global.Auth && Auth.signedIn() && Auth.myUnitId()) || nationalUnitId()),
      access: data.access, eventIds: data.eventIds, claimed: data.claimed,
      active: data.active !== false,
      createdAt: nowISO(), updatedAt: nowISO()
    });
  }

  function addPerson(data) {
    var p = buildPerson(data);
    if (!p) throw new Error('A person needs a name.');
    var held = p.email ? emailTaken(p.email) : null;
    if (held) {
      throw new Error(p.email + ' is already in the directory as ' + held.name +
        '. Edit that entry instead of adding a second one.');
    }
    state.people.push(p);
    commit();
    return p;
  }

  /* Correct the directory from the server's own record of who was enrolled.

     An officer enrolled into a college was filed under Nationals, because the
     unit chosen on the form never reached addPerson. That is fixed going
     forward, and this repairs the rows already written: the server knows which
     unit each address was enrolled into, so where the two disagree the server
     wins. Matched on email, which is the only thing both sides agree on. */
  function reconcileDirectory(rows) {
    var byCode = {};
    state.units.forEach(function (u) { byCode[u.name] = u.id; });
    var fixed = 0;

    (rows || []).forEach(function (r) {
      var addr = email(r.email);
      if (!addr) return;
      var p = personByEmail(addr);
      if (!p) return;

      var unitName = (r.units && r.units.name) || r.unit_name || '';
      var uid = byCode[unitName] || '';
      var changed = false;

      if (uid && p.unitId !== uid) { p.unitId = uid; changed = true; }
      if (r.position && p.position !== r.position) { p.position = r.position; changed = true; }
      if (r.access && p.access !== r.access) { p.access = r.access; changed = true; }
      if (!p.claimed && r.active !== undefined) { p.claimed = true; changed = true; }

      if (changed) { p.updatedAt = bumpStamp(p.updatedAt); fixed++; }
    });

    if (fixed) commit();
    return fixed;
  }

  function personByEmail(addr) {
    var want = email(addr);
    if (!want) return null;
    for (var i = 0; i < state.people.length; i++) {
      if (state.people[i].email === want) return state.people[i];
    }
    return null;
  }

  /* The head, and the person standing in, for one unit. */
  function unitHeads(unitId) {
    return people({ unitId: unitId }).filter(function (p) { return p.isHead; });
  }

  function updatePerson(id, data) {
    var p = person(id);
    if (!p) return null;
    var before = { active: p.active, unitId: p.unitId, access: p.access, isHead: p.isHead };
    if ('name' in data) p.name = (data.name || '').trim();
    if ('position' in data) p.position = (data.position || '').trim();
    if ('committee' in data) p.committee = (data.committee || '').trim();
    if ('active' in data) p.active = !!data.active;
    if ('email' in data) {
      var held = emailTaken(data.email, p.id);
      if (held) {
        throw new Error(email(data.email) + ' already belongs to ' + held.name +
          ' in the directory.');
      }
      p.email = email(data.email);
    }
    if ('unitId' in data && unit(data.unitId)) p.unitId = data.unitId;
    if ('access' in data) p.access = oneOf(data.access, ['officer', 'volunteer'], p.access);
    if ('eventIds' in data && Array.isArray(data.eventIds)) p.eventIds = data.eventIds.slice(0, 200);
    if ('claimed' in data) p.claimed = !!data.claimed;
    if ('isHead' in data) p.isHead = !!data.isHead;
    /* The permission-shaped changes, which are the ones somebody later asks
       about: who moved this person, who made them head, who switched them off.
       A corrected spelling is not history. */
    if (before.active !== p.active) logOn(p, 'person', p.active ? 'reactivated them' : 'deactivated them');
    if (before.unitId !== p.unitId) logOn(p, 'person', 'moved them to ' + unitName(p.unitId));
    if (before.access !== p.access) {
      logOn(p, 'person', 'made them ' + (p.access === 'volunteer' ? 'a volunteer' : 'an officer'));
    }
    if (before.isHead !== p.isHead) {
      logOn(p, 'person', p.isHead ? 'named them head of ' + unitName(p.unitId)
                                  : 'stood them down as head of ' + unitName(p.unitId));
    }
    p.updatedAt = bumpStamp(p.updatedAt);
    commit();
    return p;
  }

  /* ---------- volunteers ---------- */

  function volunteersFor(eventId) {
    return state.people.filter(function (p) {
      return p.access === 'volunteer' && p.active !== false &&
        (p.eventIds || []).indexOf(eventId) >= 0;
    }).sort(function (a, b) { return a.name.localeCompare(b.name); });
  }

  /* Taking a helper off an activity. If that was the only one they were on there
     is nothing left for them to reach, so they are deactivated rather than left
     holding an account that opens onto nothing. */
  function removeVolunteerFrom(personId, eventId) {
    var p = person(personId);
    if (!p) return null;
    p.eventIds = (p.eventIds || []).filter(function (x) { return x !== eventId; });
    if (!p.eventIds.length) p.active = false;
    p.updatedAt = bumpStamp(p.updatedAt);
    commit();
    return p;
  }

  // People are deactivated, never deleted, so past tasks keep their assignee.
  function setPersonActive(id, active) { return updatePerson(id, { active: active }); }

  /* What removing somebody would actually disturb. Asked before the fact so the
     confirmation can say it, rather than after, when it is a surprise. */
  function personHolds(id) {
    var assigned = state.tasks.filter(function (t) { return t.assigneeId === id; }).length;
    var heads = state.events.filter(function (e) { return e.headId === id; }).length;
    var carries = state.letters.filter(function (l) {
      return l.inChargeId === id && l.status === 'Routing';
    }).length;
    return { tasks: assigned, events: heads, letters: carries,
             total: assigned + heads + carries };
  }

  /* Removing a person, as opposed to deactivating one.

     Deactivating is right for an officer whose term ended: their name stays on
     the work they did, which is the whole point of a record. Removing is for a
     name that should never have been in the list — a typo, a duplicate, someone
     added to the wrong unit. Both are needed, and only the person doing it can
     tell which case this is.

     Whatever they held is released rather than deleted with them. A task
     survives losing its assignee; deleting the task because the person left
     would destroy the council's own record of the work. */
  /* Duplicates, and getting rid of them without anybody clicking Remove sixty
     times.

     They came from syncing the dry run. Each device seeds its own rehearsal with
     its own ids, so a second phone pulled the first one's thirteen invented
     officers, kept its own thirteen, and pushed them back — and every device
     after that made it worse. That no longer happens, but a council that has
     already synced is left holding the mess, and telling them to tidy it by hand
     is not an answer.

     Two people are the same person when the name and the unit match. Whoever was
     recorded first is kept, because that is the row other devices are most
     likely to agree on, and everything pointing at the others is moved onto it
     rather than deleted with them. */
  function duplicatePeople() {
    var groups = {};
    state.people.forEach(function (p) {
      var key = String(p.name || '').trim().toLowerCase() + '|' + (p.unitId || '');
      (groups[key] = groups[key] || []).push(p);
    });
    var dupes = [];
    Object.keys(groups).forEach(function (k) {
      if (groups[k].length > 1) dupes.push(groups[k]);
    });
    return dupes;
  }

  function duplicatePeopleCount() {
    return duplicatePeople().reduce(function (n, g) { return n + g.length - 1; }, 0);
  }

  function mergeDuplicatePeople() {
    var removed = 0;
    var dropped = {};

    duplicatePeople().forEach(function (group) {
      // Oldest first; the one the rest are folded into.
      group.sort(function (a, b) { return String(a.createdAt).localeCompare(String(b.createdAt)); });
      var keep = group[0];

      group.slice(1).forEach(function (drop) {
        state.tasks.forEach(function (t) {
          if (t.assigneeId === drop.id) { t.assigneeId = keep.id; t.updatedAt = bumpStamp(t.updatedAt); }
        });
        state.events.forEach(function (e) {
          if (e.headId === drop.id) { e.headId = keep.id; e.updatedAt = bumpStamp(e.updatedAt); }
        });
        state.letters.forEach(function (l) {
          if (l.inChargeId === drop.id) { l.inChargeId = keep.id; l.updatedAt = bumpStamp(l.updatedAt); }
        });
        // The activities they were taken on for belong to the person, not the row.
        (drop.eventIds || []).forEach(function (evId) {
          if ((keep.eventIds || []).indexOf(evId) < 0) keep.eventIds.push(evId);
        });
        // A duplicate that somebody had deactivated should not deactivate the keeper.
        if (drop.active !== false) keep.active = true;
        if (!keep.email && drop.email) keep.email = drop.email;

        tombstone('person', drop.id);
        dropped[drop.id] = true;
        removed++;
      });

      keep.updatedAt = bumpStamp(keep.updatedAt);
    });

    if (removed) {
      /* Only the rows this merge folded away. Reading the tombstone list instead
         would also take out anybody removed earlier for an unrelated reason. */
      state.people = state.people.filter(function (p) { return !dropped[p.id]; });
      commit();
    }
    return removed;
  }

  function deletePerson(id) {
    var p = person(id);
    if (!p) return false;

    state.tasks.forEach(function (t) {
      if (t.assigneeId === id) { t.assigneeId = ''; t.updatedAt = bumpStamp(t.updatedAt); }
    });
    state.events.forEach(function (e) {
      if (e.headId === id) { e.headId = ''; e.updatedAt = bumpStamp(e.updatedAt); }
    });
    state.letters.forEach(function (l) {
      if (l.inChargeId !== id) return;
      // The name is kept as typed text so the trail still says who was carrying it.
      l.inChargeId = '';
      if (!l.inChargeName) l.inChargeName = p.name;
      l.updatedAt = bumpStamp(l.updatedAt);
    });

    tombstone('person', id);
    state.people = state.people.filter(function (x) { return x.id !== id; });
    // The assignee picker remembers whoever was chosen last; it must not
    // remember somebody who is no longer in the directory.
    if (lastPerson() === id) setLastPerson('');
    commit();
    return true;
  }

  /* ---------- units ---------- */

  function units(opts) {
    opts = opts || {};
    var list = state.units.slice();
    if (opts.activeOnly) list = list.filter(function (u) { return u.active !== false; });
    if (opts.kind) list = list.filter(function (u) { return u.kind === opts.kind; });
    // The National government's own view: itself and the provinces, never the
    // independent bodies.
    if (opts.governed) list = list.filter(function (u) { return !isIndependent(u); });
    if (opts.independentOnly) list = list.filter(isIndependent);
    // National first, then the provinces alphabetically, then COMELEC and the
    // Judiciary — the order the Republic is usually written down in.
    return list.sort(function (a, b) {
      var d = UNIT_KIND_RANK[a.kind] - UNIT_KIND_RANK[b.kind];
      return d !== 0 ? d : a.name.localeCompare(b.name);
    });
  }

  function unit(id) {
    if (!id) return null;
    for (var i = 0; i < state.units.length; i++) if (state.units[i].id === id) return state.units[i];
    return null;
  }

  function unitName(id) {
    var u = unit(id);
    return u ? u.name : 'Unassigned unit';
  }

  function unitKindLabel(kind) { return UNIT_KIND_LABEL[kind] || 'Province'; }

  function nationalUnit() {
    for (var i = 0; i < state.units.length; i++) {
      if (state.units[i].kind === 'national') return state.units[i];
    }
    return state.units[0] || null;
  }

  function nationalUnitId() {
    var u = nationalUnit();
    return u ? u.id : '';
  }

  function addUnit(data) {
    var u = cleanUnit({
      id: U.uid('unt'),
      kind: data.kind, code: data.code, name: data.name,
      trackerName: data.trackerName, active: true,
      createdAt: nowISO(), updatedAt: nowISO()
    });
    if (!u) throw new Error('A unit needs a name.');
    // Only one National government, by definition.
    if (u.kind === 'national' && nationalUnit()) u.kind = 'province';
    state.units.push(u);
    commit();
    return u;
  }

  function updateUnit(id, data) {
    var u = unit(id);
    if (!u) return null;
    if ('name' in data) u.name = str(data.name, LIMITS.org) || u.name;
    if ('trackerName' in data) u.trackerName = str(data.trackerName, LIMITS.org);
    if ('code' in data) u.code = str(data.code, 16).toUpperCase().replace(/[^A-Z0-9-]/g, '');
    // The National unit's kind is never edited away, or council-wide work would
    // have nowhere to sit.
    if ('kind' in data && u.kind !== 'national' && UNIT_KINDS.indexOf(data.kind) >= 0 &&
        data.kind !== 'national') {
      u.kind = data.kind;
    }
    if ('active' in data && u.kind !== 'national') u.active = !!data.active;
    u.updatedAt = bumpStamp(u.updatedAt);
    commit();
    return u;
  }

  function setUnitActive(id, active) { return updateUnit(id, { active: active }); }

  /* A unit is only ever removed while it is empty. Once it holds events it is
     deactivated instead, so past work keeps the unit it was filed under. */
  function unitEventCount(id) {
    return state.events.filter(function (e) { return e.unitId === id; }).length;
  }

  function deleteUnit(id) {
    var u = unit(id);
    if (!u) return false;
    if (u.kind === 'national') throw new Error('The National government cannot be removed.');
    if (unitEventCount(id)) {
      throw new Error('That unit still holds events. Set it inactive instead, so its work keeps its unit.');
    }
    state.units = state.units.filter(function (x) { return x.id !== id; });
    commit();
    return true;
  }

  /* How a unit is doing: its events, and the work inside them. Archived events
     are left out, the same way they are everywhere else. */
  function unitStats(unitId) {
    var evs = state.events.filter(function (e) {
      return e.unitId === unitId && !isShelved(e) && !isDirectiveSet(e);
    });
    var ids = {};
    evs.forEach(function (e) { ids[e.id] = true; });
    var s = stats(state.tasks.filter(function (t) {
      return (t.kind || 'event') === 'event' && ids[t.eventId];
    }));
    s.events = evs.length;
    s.running = evs.filter(function (e) {
      return e.status === 'Upcoming' || e.status === 'Ongoing';
    }).length;
    return s;
  }

  /* ---------- events ---------- */

  /* Off the working lists: archived, or called off. Neither is deleted and both
     keep everything they hold; they simply stop counting as work in hand. */
  function isShelved(e) {
    return !!e && (e.status === 'Archived' || e.status === 'Cancelled');
  }

  function isCancelled(e) { return !!e && e.status === 'Cancelled'; }

  // A directive that holds tasks, as opposed to an activity.
  function isDirectiveSet(e) { return !!e && (e.kind || 'event') === 'directive'; }

  /* Activities by default. A directive set lives in the same list and would
     otherwise turn up on the Events tab, in the Overview's counts and in what a
     unit owes the term — so it is asked for by name or not at all. */
  function events(opts) {
    opts = opts || {};
    var list = state.events.slice();
    if (opts.kind !== 'any') {
      var want = opts.kind === 'directive' ? 'directive' : 'event';
      list = list.filter(function (e) { return (e.kind || 'event') === want; });
    }
    if (opts.unitId) list = list.filter(function (e) { return e.unitId === opts.unitId; });
    if (opts.excludeArchived) list = list.filter(function (e) { return !isShelved(e); });
    if (opts.activeOnly) {
      list = list.filter(function (e) { return e.status === 'Upcoming' || e.status === 'Ongoing'; });
    }
    return list.sort(function (a, b) {
      var ad = a.dateStart || '9999-12-31', bd = b.dateStart || '9999-12-31';
      if (ad !== bd) return ad < bd ? -1 : 1;
      return a.title.localeCompare(b.title);
    });
  }

  /* The directives that hold tasks, newest business first. */
  function directiveSets(opts) {
    opts = opts || {};
    var list = events({ kind: 'directive', unitId: opts.unitId });
    if (opts.excludeArchived) list = list.filter(function (e) { return !isShelved(e); });
    return list;
  }

  /* Every piece of directive work there is: the single ones, and the tasks
     inside directives that hold several. The end-of-term record asks for this,
     and so does anybody wondering what the council still owes itself. */
  function directiveWork(opts) {
    opts = opts || {};
    var sets = {};
    directiveSets().forEach(function (d) { sets[d.id] = d; });
    return state.tasks.filter(function (t) {
      if ((t.kind || 'event') === 'directive') return true;
      return !!sets[t.eventId];
    }).map(function (t) {
      return { task: t, setTitle: sets[t.eventId] ? sets[t.eventId].title : '' };
    }).filter(function (r) { return !opts.pendingOnly || isPending(r.task); });
  }

  function event(id) {
    if (!id) return null;
    for (var i = 0; i < state.events.length; i++) if (state.events[i].id === id) return state.events[i];
    return null;
  }

  /* The same reasoning as tasks. The event form already refuses a blank title
     and an end before the start; the store did not, so anything arriving by
     another route could file an activity that finishes before it begins. */
  function checkEventDates(start, end) {
    if (end && start && end < start) {
      throw new Error('An activity cannot end before it starts.');
    }
  }

  function addEvent(data) {
    var e = buildEvent(data);
    state.events.push(e);
    commit();
    return e;
  }

  /* An activity, checked and ready, not yet saved. Split from addEvent so an
     activity started from a template can be saved together with its tasks in
     one write — twelve saves and twelve redraws for one button is how a phone
     stutters. */
  function buildEvent(data) {
    if (!String(data.title || '').trim()) throw new Error('An activity needs a title.');
    checkEventDates(dateOnly(data.dateStart), dateOnly(data.dateEnd));
    var directive = data.kind === 'directive';
    var e = {
      id: U.uid('evt'),
      kind: directive ? 'directive' : 'event',
      // Unstated means the council's own: National work.
      unitId: unit(data.unitId) ? data.unitId : nationalUnitId(),
      title: (data.title || '').trim(),
      description: (data.description || '').trim(),
      dateStart: dateOnly(data.dateStart),
      dateEnd: dateOnly(data.dateEnd),
      venue: (data.venue || '').trim(),
      headId: data.headId || '',
      status: EVENT_STATUSES.indexOf(data.status) >= 0 ? data.status : 'Upcoming',
      // Nobody evaluates a directive, so it is never asked for a feedback form.
      feedbackRequired: !directive && data.feedbackRequired !== false,
      feedbackLink: data.feedbackLink || '',
      history: [],
      createdAt: nowISO(),
      updatedAt: nowISO()
    };
    // A new activity dated inside a closed year would be filed straight into its archive.
    assertOpen('event', e);
    logOn(e, 'event', data.historyNote || ('created this ' + (directive ? 'directive' : 'event')));
    return e;
  }

  /* The line a status change leaves in the history. */
  function eventStatusLine(e, from, to) {
    var noun = isDirectiveSet(e) ? 'directive' : 'activity';
    if (to === 'Completed') return 'marked the ' + noun + ' completed';
    if (to === 'Archived') return 'archived the ' + noun;
    if (from === 'Archived') return 'restored the ' + noun + ' from the archive';
    return 'set the status to ' + to;
  }

  function updateEvent(id, data) {
    var e = event(id);
    if (!e) return null;
    assertOpen('event', e);
    if ('title' in data && !String(data.title || '').trim()) {
      throw new Error('An activity needs a title.');
    }
    var start = 'dateStart' in data ? dateOnly(data.dateStart) : e.dateStart;
    var end = 'dateEnd' in data ? dateOnly(data.dateEnd) : e.dateEnd;
    checkEventDates(start, end);
    // Nor may a new date carry it into a closed year.
    if (yearLocked(yearOfDate(start || U.dayOf(e.createdAt)))) {
      throw new Error('That date falls in an archived academic year. Pick a date in the current year.');
    }
    var before = {
      title: e.title, dateStart: e.dateStart, dateEnd: e.dateEnd, status: e.status,
      headId: e.headId, description: e.description, venue: e.venue, feedbackLink: e.feedbackLink
    };
    ['title', 'description', 'venue'].forEach(function (k) {
      if (k in data) e[k] = (data[k] || '').trim();
    });
    e.dateStart = start;
    e.dateEnd = end;
    if ('headId' in data) e.headId = data.headId && person(data.headId) ? data.headId : '';
    if ('status' in data && EVENT_STATUSES.indexOf(data.status) >= 0) e.status = data.status;
    if ('unitId' in data && unit(data.unitId)) e.unitId = data.unitId;
    if ('feedbackLink' in data) e.feedbackLink = formLink(data.feedbackLink);

    /* What changed, said once each. Wording edits to the description or the
       venue are one line between them: somebody reading the history wants to
       know the details were touched, not a diff. */
    var dir = isDirectiveSet(e);
    if (e.title !== before.title) {
      logOn(e, 'event', 'renamed the ' + (dir ? 'directive' : 'event') + ' to “' + e.title + '”');
    }
    if (e.dateStart !== before.dateStart || e.dateEnd !== before.dateEnd) {
      logOn(e, 'event', e.dateStart ? 'moved the date to ' + U.fmtRange(e.dateStart, e.dateEnd)
                                    : 'cleared the date');
    }
    if (e.status !== before.status) logOn(e, 'event', eventStatusLine(e, before.status, e.status));
    if (e.headId !== before.headId) {
      logOn(e, 'event', e.headId
        ? 'made ' + personName(e.headId) + (dir ? ' answerable for it' : ' the event head')
        : 'cleared the ' + (dir ? 'person answerable' : 'event head'));
    }
    if (e.feedbackLink !== before.feedbackLink) {
      logOn(e, 'event', e.feedbackLink ? 'added the feedback form' : 'removed the feedback form link');
    }
    if (e.description !== before.description || e.venue !== before.venue) {
      logOn(e, 'event', 'edited the details');
    }
    e.updatedAt = bumpStamp(e.updatedAt);
    commit();
    return e;
  }

  /* ---------- the code a volunteer joins with ----------

     Taking on forty helpers meant typing forty names and handing out forty
     passwords. The activity carries a code instead; a volunteer types the code
     and their own name at the door and is in, as a volunteer of that activity
     and nothing else. Replacing the code shuts out everybody who joined with
     the old one, which is the only revoking a council ever needs. */
  function makeVolunteerCode(id) {
    var e = event(id);
    if (!e) return null;
    assertOpen('event', e);
    if (isDirectiveSet(e)) throw new Error('A directive takes no volunteers.');
    if (isShelved(e) || e.status === 'Completed') {
      throw new Error('That activity is over, so a code would open nothing.');
    }

    var word = (e.title || 'ACTIVITY').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 10) || 'ACTIVITY';
    var code = '';
    var taken = function (c) {
      return state.events.some(function (x) { return x.id !== e.id && x.volunteerCode === c; });
    };
    for (var tries = 0; tries < 40; tries++) {
      // Four digits, and never one that reads as another activity's.
      code = word + '-' + String(1000 + Math.floor(Math.random() * 9000));
      if (!taken(code)) break;
    }
    e.volunteerCode = code;
    e.volunteerCodeAt = nowISO();
    e.updatedAt = bumpStamp(e.updatedAt);
    commit();
    return code;
  }

  function clearVolunteerCode(id) {
    var e = event(id);
    if (!e) return null;
    assertOpen('event', e);
    e.volunteerCode = '';
    e.volunteerCodeAt = '';
    e.updatedAt = bumpStamp(e.updatedAt);
    commit();
    return e;
  }

  function eventByVolunteerCode(code) {
    var want = String(code || '').toUpperCase().replace(/[^A-Z0-9-]/g, '');
    if (!want) return null;
    return state.events.filter(function (e) { return e.volunteerCode === want; })[0] || null;
  }

  /* Calling an activity off.

     Not the same as deleting it and not the same as archiving it. The council
     decided to hold it and then decided not to, and both decisions are part of
     the year's record — so the activity stays exactly where it is, with its
     tasks and its letters, and stops appearing in anybody's work. The reason is
     required because "cancelled" with nothing beside it is a question somebody
     has to chase at the end of the term. */
  function cancelEvent(id, opts) {
    opts = opts || {};
    var e = event(id);
    if (!e) return null;
    assertOpen('event', e);
    var reason = String(opts.reason || '').trim();
    if (!reason) throw new Error('Say why it was called off. One line is enough.');
    if (e.status === 'Cancelled') throw new Error('That activity is already cancelled.');

    var on = dateOnly(opts.rescheduleDate);
    if (on && on < U.today()) throw new Error('A new date has to be in the future.');

    e.status = 'Cancelled';
    e.cancelReason = str(reason, LIMITS.reason);
    e.cancelledBy = str(opts.by, LIMITS.name);
    e.cancelledAt = nowISO();
    e.rescheduleWanted = !!opts.rescheduleWanted;
    e.rescheduleDate = e.rescheduleWanted ? on : '';
    logOn(e, 'event', 'called the activity off: \u201c' + e.cancelReason + '\u201d');
    e.updatedAt = bumpStamp(e.updatedAt);
    commit();
    return e;
  }

  /* Holding it after all. The new dates go on the activity, the cancellation is
     cleared, and everything it was carrying comes back with it — that is the
     whole reason a cancelled activity is kept rather than deleted. */
  function reinstateEvent(id, data) {
    data = data || {};
    var e = event(id);
    if (!e) return null;
    assertOpen('event', e);
    if (e.status !== 'Cancelled') throw new Error('That activity is not cancelled.');

    var start = 'dateStart' in data ? dateOnly(data.dateStart) : e.dateStart;
    var end = 'dateEnd' in data ? dateOnly(data.dateEnd) : e.dateEnd;
    checkEventDates(start, end);

    e.dateStart = start;
    e.dateEnd = end;
    e.status = start && start <= U.today() && (!end || end >= U.today()) ? 'Ongoing' : 'Upcoming';
    e.cancelReason = '';
    e.cancelledBy = '';
    e.cancelledAt = '';
    e.rescheduleWanted = false;
    e.rescheduleDate = '';
    logOn(e, 'event', 'put the activity back on' +
      (e.dateStart ? ' for ' + U.fmtRange(e.dateStart, e.dateEnd) : ''));
    e.updatedAt = bumpStamp(e.updatedAt);
    commit();
    return e;
  }

  /* Whether this activity still owes a feedback form. Derived, never stored, so
     it cannot drift from the link and the waiver. */
  function needsFeedback(e) {
    if (!e) return false;
    // An activity that never happened has nobody to ask for feedback, and a
    // directive is not an activity at all.
    if (isCancelled(e) || isDirectiveSet(e)) return false;
    return e.feedbackRequired !== false && !e.feedbackLink;
  }

  function setFeedbackLink(id, link) {
    var e = event(id);
    if (!e) return null;
    assertOpen('event', e);
    var v = formLink(link);
    if (link && !v) {
      throw new Error('That needs to be a Google Forms link — docs.google.com/forms or forms.gle.');
    }
    if (v !== e.feedbackLink) {
      logOn(e, 'event', v ? 'added the feedback form' : 'removed the feedback form link');
    }
    e.feedbackLink = v;
    e.updatedAt = bumpStamp(e.updatedAt);
    commit();
    return e;
  }

  /* Waiving the requirement. The standard is that every activity is evaluated,
     so stepping outside it is written down rather than silently toggled. */
  function waiveFeedback(id, reason, by) {
    var e = event(id);
    if (!e) return null;
    assertOpen('event', e);
    var r = (reason || '').trim();
    if (r.length < 10) {
      throw new Error('Write down why this activity does not need a feedback form.');
    }
    logOn(e, 'event', 'set the feedback form aside: \u201c' + str(r, 120) + '\u201d');
    e.feedbackRequired = false;
    e.feedbackWaivedReason = str(r, LIMITS.reason);
    e.feedbackWaivedBy = str(by || '', LIMITS.name);
    e.feedbackWaivedAt = nowISO();
    e.updatedAt = bumpStamp(e.updatedAt);
    commit();
    return e;
  }

  function restoreFeedback(id) {
    var e = event(id);
    if (!e) return null;
    assertOpen('event', e);
    logOn(e, 'event', 'required a feedback form again');
    e.feedbackRequired = true;
    e.feedbackWaivedReason = '';
    e.feedbackWaivedBy = '';
    e.feedbackWaivedAt = '';
    e.updatedAt = bumpStamp(e.updatedAt);
    commit();
    return e;
  }

  function deleteEvent(id) {
    assertOpen('event', event(id));
    state.tasks.forEach(function (t) { if (t.eventId === id) tombstone('task', t.id); });

    /* The report was marked deleted and then left sitting in state, so it
       lingered until the next page load tidied it away — and its photographs
       were never freed at all. A term's worth of deleted activities leaves
       hundreds of megabytes stranded in a phone's storage with nothing on any
       screen to say so. */
    var doomed = state.reports.filter(function (r) { return r.eventId === id; });
    doomed.forEach(function (r) { tombstone('report', r.id); });
    state.reports = state.reports.filter(function (r) { return r.eventId !== id; });

    state.tasks = state.tasks.filter(function (t) { return t.eventId !== id; });

    /* A letter is the council's correspondence, not the activity's, so it stays
       — but it used to go on naming the activity that was deleted, and show a
       blank where the title had been. It is simply unattached now. */
    state.letters.forEach(function (l) {
      if (l.eventId === id) { l.eventId = ''; l.updatedAt = bumpStamp(l.updatedAt); }
    });

    tombstone('event', id);
    state.events = state.events.filter(function (e) { return e.id !== id; });
    commit();

    if (global.AssetDB) {
      doomed.forEach(function (r) { global.AssetDB.delPrefix(r.id + ':'); });
    }
  }

  /* ---------- tasks ---------- */

  function tasks(filter) {
    filter = filter || {};
    var list = state.tasks.slice();
    if (filter.eventId) list = list.filter(function (t) { return t.eventId === filter.eventId; });
    if (filter.unitId) {
      list = list.filter(function (t) {
        var e = event(t.eventId);
        return !!e && e.unitId === filter.unitId;
      });
    }
    if (filter.kind) list = list.filter(function (t) { return (t.kind || 'event') === filter.kind; });
    if (filter.assigneeId !== undefined) {
      list = list.filter(function (t) { return (t.assigneeId || '') === (filter.assigneeId || ''); });
    }
    if (filter.status) list = list.filter(function (t) { return t.status === filter.status; });
    if (filter.pendingOnly) list = list.filter(function (t) { return t.status !== 'Done'; });
    if (filter.overdueOnly) list = list.filter(isOverdue);
    if (filter.excludeArchived) {
      list = list.filter(function (t) {
        if ((t.kind || 'event') === 'directive') return true;
        var e = event(t.eventId);
        // Not here is not shelved: it may be an activity this person cannot open.
        return !e || !isShelved(e);
      });
    }
    return list;
  }

  function task(id) {
    if (!id) return null;
    for (var i = 0; i < state.tasks.length; i++) if (state.tasks[i].id === id) return state.tasks[i];
    return null;
  }

  function addTask(data) {
    var t = buildTask(data);
    state.tasks.push(t);
    commit();
    return t;
  }

  function buildTask(data) {
    // A directive is council business that belongs to no activity — a standing
    // instruction. Everything else still has to sit inside an event.
    var isDirective = data.kind === 'directive';
    if (!isDirective && (!data.eventId || !(event(data.eventId) || data.eventReady))) {
      throw new Error('A task must belong to an event.');
    }
    /* The forms all check these first. The store checks them too, because a
       roster import, a restored backup and whatever is added next do not go
       through a form — and it was accepting a blank title, a due date of
       "not-a-date", and a holder who does not exist. */
    if (!String(data.title || '').trim()) throw new Error('A task needs a title.');
    var t = {
      id: U.uid('tsk'),
      kind: isDirective ? 'directive' : 'event',
      eventId: isDirective ? '' : data.eventId,
      /* A directive has no activity, so it has nothing to be scoped by unless it
         carries a unit of its own. Everything else reads its unit through the
         activity it sits in, and keeps doing so. */
      unitId: isDirective
        ? (data.unitId || (global.Auth && Auth.signedIn() && Auth.myUnitId()) || nationalUnitId())
        : '',
      title: (data.title || '').trim(),
      remarks: (data.remarks || '').trim(),
      assigneeId: data.assigneeId && person(data.assigneeId) ? data.assigneeId : '',
      dueDate: dateOnly(data.dueDate),
      priority: PRIORITIES.indexOf(data.priority) >= 0 ? data.priority : 'Medium',
      status: STATUSES.indexOf(data.status) >= 0 ? data.status : 'Not Started',
      blockedReason: (data.blockedReason || '').trim(),
      completedAt: '',
      history: [],
      createdAt: nowISO(),
      updatedAt: nowISO()
    };
    if (t.status === 'Done') t.completedAt = nowISO();
    assertOpen('task', t);
    logOn(t, 'task', 'created the task \u201c' + t.title + '\u201d' +
      (t.assigneeId ? ' and gave it to ' + personName(t.assigneeId) : ''));
    return t;
  }

  /* The lines an edit to a task leaves, each naming the task — they are read
     inside the task, and also gathered into its activity's history, where a
     line without the task's name would say nothing. */
  function logTaskChanges(t, before) {
    var name = '\u201c' + before.title + '\u201d';
    if (t.title !== before.title) {
      logOn(t, 'task', 'renamed ' + name + ' to \u201c' + t.title + '\u201d');
      name = '\u201c' + t.title + '\u201d';
    }
    if (t.assigneeId !== before.assigneeId) {
      logOn(t, 'task', t.assigneeId
        ? 'assigned ' + name + ' to ' + personName(t.assigneeId)
        : 'took ' + name + ' off ' + personName(before.assigneeId));
    }
    if (t.status !== before.status) {
      logOn(t, 'task', 'changed ' + name + ' \u2192 ' + t.status +
        (t.status === 'On hold' && t.blockedReason ? ' (' + str(t.blockedReason, 80) + ')' : ''));
    }
    if (t.dueDate !== before.dueDate) {
      logOn(t, 'task', t.dueDate
        ? 'moved the due date of ' + name + ' to ' + U.fmtDateShort(t.dueDate)
        : 'cleared the due date of ' + name);
    }
    if (t.priority !== before.priority) logOn(t, 'task', 'set ' + name + ' to ' + t.priority + ' priority');
    if (t.eventId !== before.eventId) {
      var ev = event(t.eventId);
      logOn(t, 'task', 'moved ' + name + (ev ? ' to \u201c' + ev.title + '\u201d' : ''));
    }
    if (t.remarks !== before.remarks) logOn(t, 'task', 'edited the remarks on ' + name);
  }

  function updateTask(id, data) {
    var t = task(id);
    if (!t) return null;
    assertOpen('task', t);
    if ('eventId' in data && data.eventId !== t.eventId) assertOpen('event', event(data.eventId));
    if ('title' in data && !String(data.title || '').trim()) {
      throw new Error('A task needs a title.');
    }
    var before = {
      title: t.title, assigneeId: t.assigneeId, status: t.status, dueDate: t.dueDate,
      priority: t.priority, eventId: t.eventId, remarks: t.remarks
    };
    ['title', 'remarks', 'blockedReason'].forEach(function (k) {
      if (k in data) t[k] = (data[k] || '').trim();
    });
    // Nobody this device knows is the same as nobody: it reads as unassigned,
    // in red, and can be given to somebody real.
    if ('assigneeId' in data) {
      t.assigneeId = data.assigneeId && person(data.assigneeId) ? data.assigneeId : '';
    }
    if ('dueDate' in data) t.dueDate = dateOnly(data.dueDate);
    if ('eventId' in data && event(data.eventId)) t.eventId = data.eventId;
    if ('priority' in data && PRIORITIES.indexOf(data.priority) >= 0) t.priority = data.priority;
    if ('status' in data && STATUSES.indexOf(data.status) >= 0) applyStatus(t, data.status);
    if (t.status !== 'On hold') t.blockedReason = '';
    logTaskChanges(t, before);
    t.updatedAt = bumpStamp(t.updatedAt);
    commit();
    return t;
  }

  // completedAt is stamped the moment a task becomes Done, and cleared if it reopens.
  function applyStatus(t, status) {
    if (status === 'Done' && t.status !== 'Done') t.completedAt = nowISO();
    if (status !== 'Done') t.completedAt = '';
    t.status = status;
  }

  function setTaskStatus(id, status, blockedReason) {
    var patch = { status: status };
    if (status === 'On hold') patch.blockedReason = blockedReason || '';
    return updateTask(id, patch);
  }

  function deleteTask(id) {
    var t = task(id);
    assertOpen('task', t);
    /* The task goes, and its history with it — so the activity keeps the one
       line that says it was ever there. Not bumped as an edit of the activity
       by anybody's hand; it is bookkeeping, but it has to travel. */
    var ev = t && t.eventId ? event(t.eventId) : null;
    if (ev) {
      logOn(ev, 'event', 'deleted the task \u201c' + t.title + '\u201d');
      ev.updatedAt = bumpStamp(ev.updatedAt);
    }
    tombstone('task', id);
    state.tasks = state.tasks.filter(function (x) { return x.id !== id; });
    commit();
  }

  /* ---------- derived (never stored) ---------- */

  function isOverdue(t) {
    return !!t.dueDate && t.status !== 'Done' && t.dueDate < U.today();
  }

  function isPending(t) { return t.status !== 'Done'; }

  function isDueToday(t) { return !!t.dueDate && t.status !== 'Done' && t.dueDate === U.today(); }

  function isDueThisWeek(t) {
    return !!t.dueDate && t.status !== 'Done' && U.isWithin(t.dueDate, U.today(), U.endOfWeek());
  }

  function stats(list) {
    var s = { total: list.length, done: 0, pending: 0, overdue: 0, dueThisWeek: 0,
              blocked: 0, unassigned: 0 };
    list.forEach(function (t) {
      if (t.status === 'Done') s.done++; else s.pending++;
      if (isOverdue(t)) s.overdue++;
      if (isDueThisWeek(t)) s.dueThisWeek++;
      if (t.status === 'On hold') s.blocked++;
      /* Work nobody has taken. Finished work does not count: a task that got
         done without ever being assigned needs nobody now, and counting it
         would send an officer looking for a problem that has already gone. */
      if (!t.assigneeId && t.status !== 'Done') s.unassigned++;
    });
    s.percent = U.pct(s.done, s.total);
    return s;
  }

  function eventStats(eventId) { return stats(tasks({ eventId: eventId })); }

  // Sort helpers used by every list in the app. Soonest deadline first is the default.
  var PRIORITY_RANK = { High: 0, Medium: 1, Low: 2 };
  var STATUS_RANK = { 'On hold': 0, 'In Progress': 1, 'For Review': 2, 'Not Started': 3, Done: 4 };

  function byDueDate(a, b) {
    var ad = a.dueDate || '9999-12-31', bd = b.dueDate || '9999-12-31';
    if (ad !== bd) return ad < bd ? -1 : 1;
    return (PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority]) || a.title.localeCompare(b.title);
  }

  function byPriority(a, b) {
    var d = PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority];
    return d !== 0 ? d : byDueDate(a, b);
  }

  function byStatus(a, b) {
    var d = STATUS_RANK[a.status] - STATUS_RANK[b.status];
    return d !== 0 ? d : byDueDate(a, b);
  }

  // Pending work floats above completed work, then soonest deadline.
  function byUrgency(a, b) {
    var ad = a.status === 'Done' ? 1 : 0, bd = b.status === 'Done' ? 1 : 0;
    if (ad !== bd) return ad - bd;
    return byDueDate(a, b);
  }

  /* ---------- remembered person (per device, not part of the data) ---------- */

  function lastPerson() {
    try { return global.localStorage.getItem(PERSON_KEY) || ''; } catch (e) { return ''; }
  }

  function setLastPerson(id) {
    try {
      if (id) global.localStorage.setItem(PERSON_KEY, id);
      else global.localStorage.removeItem(PERSON_KEY);
    } catch (e) { /* storage blocked — the picker still works for this visit */ }
  }

  /* ---------- positions & committees ---------- */

  function addListValue(kind, value) {
    var v = (value || '').trim();
    if (!v) return false;
    var list = state[kind];
    if (list.some(function (x) { return x.toLowerCase() === v.toLowerCase(); })) return false;
    list.push(v);
    list.sort(function (a, b) { return a.localeCompare(b); });
    touchCouncil();
    commit();
    return true;
  }

  function removeListValue(kind, value) {
    state[kind] = state[kind].filter(function (x) { return x !== value; });
    touchCouncil();
    commit();
  }

  /* ---------- accomplishment reports ---------- */

  function report(eventId) {
    for (var i = 0; i < state.reports.length; i++) {
      if (state.reports[i].eventId === eventId) return state.reports[i];
    }
    return null;
  }

  /* The report's id is the activity's id.

     There is one report per activity — the server holds reports.event_id
     unique — but the id used to be minted at random, so two officers opening
     the wizard for the same activity before either had synced produced two
     reports with different ids and the same activity. The second to reach the
     server was refused, and that phone then failed every round afterwards.

     Deriving the id from the activity means both devices produce the same one,
     so the two become one record on arrival instead of a collision. */
  function blankReport(eventId) {
    return {
      id: eventId, eventId: eventId, description: '',
      program: { assets: [] }, photos: [], letters: [],
      minutes: { mode: 'tasks', assets: [] }, evaluation: { assets: [] },
      liquidation: { assets: [] },
      signatories: {
        preparedBy: { name: '', position: '' },
        president: { name: '', show: true },
        adviser: { name: '' }
      },
      driveLink: '', driveOwned: false, driveBy: '', driveAt: '',
      status: 'draft',
      createdAt: nowISO(), updatedAt: nowISO()
    };
  }

  function saveReport(eventId, patch) {
    if (!event(eventId)) throw new Error('That event no longer exists.');
    assertOpen('event', event(eventId));
    var r = report(eventId);
    if (!r) { r = blankReport(eventId); state.reports.push(r); }
    Object.keys(patch || {}).forEach(function (k) {
      if (k === 'id' || k === 'eventId' || k === 'createdAt') return;
      r[k] = patch[k];
    });
    r.updatedAt = bumpStamp(r.updatedAt);
    // Run it back through the sanitiser so nothing malformed can settle in state.
    var idx = state.reports.indexOf(r);
    state.reports[idx] = cleanReport(r);
    commit();
    return state.reports[idx];
  }

  function deleteReport(eventId) {
    assertOpen('event', event(eventId));
    var r = report(eventId);
    if (r) tombstone('report', r.id);
    state.reports = state.reports.filter(function (x) { return x.eventId !== eventId; });
    commit();
    if (r && global.AssetDB) global.AssetDB.delPrefix(r.id + ':');
  }

  function reports() { return state.reports.slice(); }

  /* ---------- offices and letters ----------

     A letters tracker, not a letter store. No document is ever kept here: the
     paper is the paper. What a council actually loses is not the letter, it is
     the answer to "where is it now, and who has it" — so that is all this holds.

     "Received by" is typed in by whoever handed the letter over, because the
     clerk in the Dean's office is never going to sign in to this. It is a
     logbook kept honestly, not a signature, and it is worth saying plainly so
     nobody mistakes one for the other. */

  var OFFICE_SEED_VERSION = 3;

  /* A starting list, editable in Settings. Turnaround is how long that office
     usually takes; a letter sitting longer than that is called stuck, which is
     the difference between a record and something that tells you to go and
     chase it. */
  var DEFAULT_OFFICES = [
    // The council's own signatories come first: a letter is signed inside the
    // Republic before it is sent anywhere in the University.
    ['AUTH', 'The author / Senator / Governor',    1],
    ['GOV',  'Governor / FCUSR President',         2],
    ['PRES', 'FCUSR President',                    2],
    ['ADV',  'Adviser (JHS, SHS, National)',       2],
    ['DEAN', 'Dean/Principal',                     3],
    ['OSA',  'OSA, Director',                      3],
    ['BUD',  'Budget Officer / Accountant / Business Manager', 3],
    ['VPAA', 'VP for Academic Affairs',            5],
    ['VPF',  'VP for Finance',                     5],
    ['OP',   'University President',               7],
    // Not on any of the three standard routes, but real desks a letter reaches.
    ['GUID', 'Guidance Office',                    3],
    ['PPO',  'Physical Plant Office',              3],
    ['REG',  'Office of the Registrar',            3],
    ['CM',   'Campus Ministry',                    3],
    ['SEC',  'Security Office',                    2]
  ];

  /* Every letter the council sends out is signed by the FCUSR President. It is
     not one office among the others, so the app knows which one it is. */
  var PRESIDENT_CODE = 'PRES';

  /* The three routes the council actually uses, copied from the FCUSR's own
     briefing, in the order the signatures are collected. Offered when a letter
     is created so nobody types ten offices out again — and so a letter that
     skips a desk is a decision somebody made rather than something forgotten.

     The route can still be changed afterwards: these are the common cases, not
     the only ones. */
  var ROUTE_TEMPLATES = [
    {
      name: 'Collection of money or request for budget',
      codes: ['AUTH', 'GOV', 'PRES', 'ADV', 'DEAN', 'OSA', 'BUD', 'VPAA', 'VPF', 'OP']
    },
    {
      name: 'Permission to attend a conference or seminar',
      codes: ['AUTH', 'GOV', 'PRES', 'ADV', 'DEAN', 'OSA', 'BUD', 'VPAA', 'VPF', 'OP'],
      note: 'Attach the invitation letter.'
    },
    {
      name: 'Excusing students from their classes',
      codes: ['AUTH', 'GOV', 'PRES', 'ADV', 'DEAN', 'OSA', 'VPAA']
    },
    {
      name: 'Something else — start with the council',
      codes: ['AUTH', 'GOV', 'PRES'],
      note: 'Add the University offices this particular letter has to reach.'
    }
  ];

  var LETTER_STATUSES = ['Routing', 'Approved', 'Declined', 'Withdrawn'];
  var STOP_OUTCOMES = ['Approved', 'Noted', 'Returned for revision'];

  function seedOffices() {
    return DEFAULT_OFFICES.map(function (o) {
      return {
        id: 'office-' + o[0].toLowerCase(),
        code: o[0], name: o[1], turnaroundDays: o[2], active: true,
        /* The name this office was seeded with. If it still matches, nobody has
           renamed it and a correction to the council's own wording can be
           applied; if it does not, the name on screen is somebody's decision
           and is left alone. */
        seededName: o[1],
        createdAt: SEEDED_AT, updatedAt: SEEDED_AT
      };
    });
  }

  function cleanOffice(o) {
    if (!o || typeof o !== 'object') return null;
    var name = str(o.name, LIMITS.org);
    if (!name) return null;
    var days = Number(o.turnaroundDays);
    return keepExtras(o, {
      id: id(o.id, 'off'),
      code: str(o.code, 16).toUpperCase().replace(/[^A-Z0-9-]/g, ''),
      /* Whose desk this is. Empty means the Republic's, which every unit routes
         letters through — the OSA, the Dean of Student Affairs, the President.
         A college has desks of its own that mean nothing to anybody else (its
         own Dean, its own adviser), and those carry its unit. */
      unitId: typeof o.unitId === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(o.unitId) ? o.unitId : '',
      name: name,
      seededName: str(o.seededName, LIMITS.org),
      turnaroundDays: isFinite(days) && days > 0 && days < 400 ? Math.round(days) : 3,
      active: o.active !== false,
      createdAt: stamp(o.createdAt),
      updatedAt: stamp(o.updatedAt)
    });
  }

  /* A signatory is an office wherever there is one, because an office outlives
     whoever is sitting in it — "the Dean" is still right next year. Some
     signatures belong to no office at all, though: the senator who wrote the
     letter, an accountant standing in, a person named on this letter only. So a
     stop is an office id or, failing that, a typed name, and never neither. */
  function cleanStop(st) {
    if (!st || typeof st !== 'object') return null;
    var officeId = typeof st.officeId === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(st.officeId)
      ? st.officeId : '';
    var label = str(st.label, LIMITS.name);
    if (!officeId && !label) return null;
    return {
      id: id(st.id, 'stp'),
      officeId: officeId,
      label: label,
      // Who walked it over, and who took it in. Both are names, not accounts.
      forwardedBy: str(st.forwardedBy, LIMITS.name),
      receivedBy: str(st.receivedBy, LIMITS.name),
      receivedAt: dateOnly(st.receivedAt),
      releasedAt: dateOnly(st.releasedAt),
      outcome: oneOf(st.outcome, STOP_OUTCOMES, ''),
      note: str(st.note, LIMITS.reason)
    };
  }

  function cleanLetter(l) {
    if (!l || typeof l !== 'object') return null;
    var subject = str(l.subject, LIMITS.title);
    if (!subject) return null;
    return keepExtras(l, {
      id: id(l.id, 'ltr'),
      unitId: typeof l.unitId === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(l.unitId) ? l.unitId : '',
      /* Blank means council business that belongs to no activity, exactly the
         way a directive has no event. */
      eventId: typeof l.eventId === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(l.eventId) ? l.eventId : '',
      subject: subject,
      /* Whoever is walking it round. Usually someone in the directory, but not
         always — so a typed name is allowed and kept beside the id. */
      inChargeId: typeof l.inChargeId === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(l.inChargeId)
        ? l.inChargeId : '',
      inChargeName: str(l.inChargeName, LIMITS.name),
      deadline: dateOnly(l.deadline),
      status: oneOf(l.status, LETTER_STATUSES, 'Routing'),
      /* Set only when somebody answered, in as many words, that this letter
         never leaves the council — which is the one reason the President's
         signature may be missing from it. */
      internal: !!l.internal,
      stops: (Array.isArray(l.stops) ? l.stops : []).map(cleanStop).filter(Boolean).slice(0, 30),
      sample: !!l.sample,
      createdAt: stamp(l.createdAt),
      updatedAt: stamp(l.updatedAt)
    });
  }

  /* ---------- offices ---------- */

  /* `forUnit` is what a unit may route a letter through: the Republic's desks,
     and its own. Without it the whole list comes back, which is what the
     National government maintains and what the office screen shows. */
  function offices(opts) {
    opts = opts || {};
    var list = state.offices.slice();
    if (opts.activeOnly) list = list.filter(function (o) { return o.active !== false; });
    if (opts.forUnit) {
      list = list.filter(function (o) {
        return !o.unitId || o.unitId === opts.forUnit || o.unitId === nationalUnitId();
      });
    }
    if (opts.ownedBy) list = list.filter(function (o) { return o.unitId === opts.ownedBy; });
    if (opts.republicOnly) {
      list = list.filter(function (o) { return !o.unitId || o.unitId === nationalUnitId(); });
    }
    return list.sort(function (a, b) { return a.name.localeCompare(b.name); });
  }

  // Whose desk: the Republic's, or one unit's own.
  function officeOwner(o) { return o && o.unitId && o.unitId !== nationalUnitId() ? o.unitId : ''; }

  function office(oid) {
    if (!oid) return null;
    for (var i = 0; i < state.offices.length; i++) if (state.offices[i].id === oid) return state.offices[i];
    return null;
  }

  function officeName(oid) {
    var o = office(oid);
    return o ? o.name : 'Unknown office';
  }

  /* A code is what the route templates match on, so one is derived when the
     caller has not given one — otherwise every office added from the letters
     screen would share the empty code and the templates would match the wrong
     desk. Uniqueness matters more than prettiness here. */
  /* A code nothing else will have, including on somebody else's phone.

     It used to count up from the name until it found a gap in *this* device's
     list — so two officers each adding "Office of the Chaplain" both produced
     CHAPLA, under different ids. The server holds office codes unique, so the
     second one to sync was refused, and that device then failed the same way
     every round until somebody renamed the office. Nothing on screen would have
     said which office, or why.

     Seeded offices keep their fixed codes, because the route templates and the
     reconciliation both match on them. Anything typed in gets four random
     characters after the name, which no second device is going to hit. */
  function deriveCode(name) {
    var base = String(name || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6);
    if (!base) base = 'OFF';
    var tail = '';
    for (var i = 0; i < 4; i++) {
      tail += 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'[Math.floor(Math.random() * 32)];
    }
    return (base.slice(0, 6) + '-' + tail).slice(0, 16);
  }

  function addOffice(data) {
    /* A code is unique per owner, so a college's "DEAN" cannot collide with the
       Republic's: a unit's own desks carry their unit's code in front. */
    var owner = data.unitId && data.unitId !== nationalUnitId() ? data.unitId : '';
    var code = data.code || deriveCode(data.name);
    if (owner) {
      var u = unit(owner);
      var prefix = (u && u.code ? u.code : 'UNIT') + '-';
      if (code.indexOf(prefix) !== 0) code = prefix + code;
    }
    var o = cleanOffice({
      id: U.uid('off'), code: code, name: data.name, unitId: owner,
      turnaroundDays: data.turnaroundDays, active: true,
      createdAt: nowISO(), updatedAt: nowISO()
    });
    if (!o) throw new Error('An office needs a name.');
    state.offices.push(o);
    commit();
    return o;
  }

  function updateOffice(oid, data) {
    var o = office(oid);
    if (!o) return null;
    if ('name' in data) o.name = str(data.name, LIMITS.org) || o.name;
    if ('code' in data) o.code = str(data.code, 16).toUpperCase().replace(/[^A-Z0-9-]/g, '');
    if ('turnaroundDays' in data) {
      var d = Number(data.turnaroundDays);
      if (isFinite(d) && d > 0 && d < 400) o.turnaroundDays = Math.round(d);
    }
    if ('active' in data) o.active = !!data.active;
    o.updatedAt = bumpStamp(o.updatedAt);
    commit();
    return o;
  }

  function setOfficeActive(oid, active) { return updateOffice(oid, { active: active }); }

  function officeLetterCount(oid) {
    return state.letters.filter(function (l) {
      return l.stops.some(function (s) { return s.officeId === oid; });
    }).length;
  }

  /* An office letters have passed through is deactivated, never deleted, so an
     old trail still names where the letter actually went. */
  function deleteOffice(oid) {
    if (officeLetterCount(oid)) {
      throw new Error('Letters have passed through that office. Set it inactive instead, ' +
        'so their trail still reads correctly.');
    }
    tombstone('office', oid);
    state.offices = state.offices.filter(function (o) { return o.id !== oid; });
    commit();
    return true;
  }

  function officeByCode(code) {
    for (var i = 0; i < state.offices.length; i++) {
      if (state.offices[i].code === code && state.offices[i].active !== false) return state.offices[i];
    }
    return null;
  }

  /* Which office is the President's. Returns '' if somebody has deleted or
     deactivated it, in which case the app cannot insist on a signature from a
     desk that no longer exists. */
  function presidentOfficeId() {
    var o = officeByCode(PRESIDENT_CODE);
    return o ? o.id : '';
  }

  function routeTemplates() {
    return ROUTE_TEMPLATES.map(function (t) {
      return {
        name: t.name,
        note: t.note || '',
        officeIds: t.codes.map(function (code) {
          var match = officeByCode(code);
          return match ? match.id : '';
        }).filter(Boolean)
      };
    }).filter(function (t) { return t.officeIds.length; });
  }

  /* ---------- letters ---------- */

  function letters(filter) {
    filter = filter || {};
    var list = state.letters.slice();
    if (filter.unitId) list = list.filter(function (l) { return l.unitId === filter.unitId; });
    if (filter.eventId) list = list.filter(function (l) { return l.eventId === filter.eventId; });
    if (filter.status) list = list.filter(function (l) { return l.status === filter.status; });
    if (filter.openOnly) list = list.filter(function (l) { return l.status === 'Routing'; });
    if (filter.attentionOnly) list = list.filter(letterNeedsAttention);
    return list.sort(byLetterUrgency);
  }

  function letter(lid) {
    if (!lid) return null;
    for (var i = 0; i < state.letters.length; i++) if (state.letters[i].id === lid) return state.letters[i];
    return null;
  }

  /* What to call a stop, wherever one is shown. */
  function stopName(st) {
    if (!st) return '';
    if (st.officeId) {
      var o = office(st.officeId);
      if (o) return o.name;
    }
    return st.label || 'Office';
  }

  /* How long this desk usually takes. A named person has no turnaround on
     record, so they get the same three days an unknown office would. */
  function stopTurnaround(st) {
    var o = st && st.officeId ? office(st.officeId) : null;
    return o ? o.turnaroundDays : 3;
  }

  /* Two stops are the same desk when they are the same office, or — for a
     person — the same name. Used to tell a second run at a desk from a new one. */
  function sameDesk(a, b) {
    if (!a || !b) return false;
    if (a.officeId || b.officeId) return a.officeId === b.officeId;
    return !!a.label && a.label === b.label;
  }

  function letterInCharge(l) {
    if (!l) return 'Unassigned';
    var p = person(l.inChargeId);
    return p ? p.name : (l.inChargeName || 'Unassigned');
  }

  /* A fresh attempt at the same desk, after that desk sent the letter back. */
  function respawn(st) {
    var fresh = newStop(st.officeId);
    fresh.label = st.label;
    return fresh;
  }

  function newStop(oid) {
    return {
      id: U.uid('stp'), officeId: oid, label: '', forwardedBy: '', receivedBy: '',
      receivedAt: '', releasedAt: '', outcome: '', note: ''
    };
  }

  /* A route arrives either as `route` — entries that may name an office or a
     person — or as plain `officeIds`, which is the same thing said the shorter
     way when every signatory is an office. */
  function toEntries(data) {
    if (Array.isArray(data.route)) return data.route;
    return (data.officeIds || []).map(function (oid) { return { officeId: oid }; });
  }

  function entryStop(e) {
    if (!e) return null;
    if (typeof e === 'string') e = { officeId: e };
    var oid = e.officeId && office(e.officeId) ? e.officeId : '';
    var label = str(e.label, LIMITS.name);
    if (!oid && !label) return null;
    var st = newStop(oid);
    st.label = label;
    return st;
  }

  function addLetter(data) {
    var stops = toEntries(data).map(entryStop).filter(Boolean);
    if (!stops.length) throw new Error('Choose at least one office or person to sign it.');

    var l = cleanLetter({
      id: U.uid('ltr'),
      unitId: unit(data.unitId) ? data.unitId : nationalUnitId(),
      eventId: data.eventId && event(data.eventId) ? data.eventId : '',
      subject: data.subject,
      inChargeId: data.inChargeId, inChargeName: data.inChargeName,
      deadline: data.deadline, status: 'Routing', stops: stops,
      internal: !!data.internal,
      createdAt: nowISO(), updatedAt: nowISO()
    });
    if (!l) throw new Error('Give the letter a subject.');
    state.letters.push(l);
    commit();
    return l;
  }

  function updateLetter(lid, data) {
    var l = letter(lid);
    if (!l) return null;
    assertOpen('letter', l);
    if ('subject' in data) l.subject = str(data.subject, LIMITS.title) || l.subject;
    if ('eventId' in data) l.eventId = data.eventId && event(data.eventId) ? data.eventId : '';
    if ('inChargeId' in data) l.inChargeId = person(data.inChargeId) ? data.inChargeId : '';
    if ('inChargeName' in data) l.inChargeName = str(data.inChargeName, LIMITS.name);
    if ('deadline' in data) l.deadline = dateOnly(data.deadline);
    if ('status' in data && LETTER_STATUSES.indexOf(data.status) >= 0) l.status = data.status;
    if ('internal' in data) l.internal = !!data.internal;
    if (Array.isArray(data.route) || Array.isArray(data.officeIds)) setRoute(l, toEntries(data));
    l.updatedAt = bumpStamp(l.updatedAt);
    commit();
    return l;
  }

  /* An office that has the letter in front of it can refuse to sign until
     somebody else has signed first. That happens constantly, and until now the
     only way to record it was to edit the whole route — which is the one thing
     you cannot do calmly while standing at a counter. So: put a desk in at a
     named place, without disturbing anything already signed.

     `before` is the index to insert at. Anything already received or released
     is history and cannot be pushed aside, so the insertion point is clamped
     past it. */
  function insertStop(lid, entry, before) {
    var l = letter(lid);
    if (!l) return null;
    assertOpen('letter', l);
    var st = entryStop(entry);
    if (!st) throw new Error('Choose an office, or type who has to sign.');
    if (l.stops.length >= 30) throw new Error('That letter already has thirty signatories on it.');

    var settled = l.stops.filter(function (s) { return s.receivedAt || s.releasedAt; }).length;
    var at = Math.max(settled, Math.min(Number(before), l.stops.length));
    if (!isFinite(at)) at = l.stops.length;

    l.stops.splice(at, 0, st);
    l.updatedAt = bumpStamp(l.updatedAt);
    commit();
    return l;
  }

  /* Changing the route keeps whatever has already happened. A stop an office has
     already taken the letter in at stays exactly as recorded, and only the ones
     not yet reached are rearranged — history is not editable by reordering. */
  function setRoute(l, entries) {
    var kept = l.stops.filter(function (s) { return s.receivedAt || s.releasedAt; });
    var fresh = entries.map(entryStop).filter(Boolean).filter(function (st) {
      return !kept.some(function (k) { return sameDesk(k, st); });
    }).map(function (st) {
      // Reuse the entry already standing for that desk, so its id survives.
      var existing = l.stops.filter(function (s) {
        return sameDesk(s, st) && !s.receivedAt && !s.releasedAt;
      })[0];
      return existing || st;
    });
    l.stops = kept.concat(fresh).slice(0, 30);
  }

  function deleteLetter(lid) {
    assertOpen('letter', letter(lid));
    tombstone('letter', lid);
    state.letters = state.letters.filter(function (l) { return l.id !== lid; });
    commit();
  }

  /* ---------- where is it? ----------
     Everything below is worked out from the trail rather than stored, so it can
     never drift out of step with what was actually recorded. */

  function wasReturned(s) { return !!s && s.outcome === 'Returned for revision'; }

  function currentStop(l) {
    if (!l) return null;
    for (var i = 0; i < l.stops.length; i++) {
      if (!l.stops[i].releasedAt) return l.stops[i];
    }
    return null;
  }

  /* A second run at the same desk. When an office sends a letter back, the
     return stays in the trail as its own entry and a fresh one is opened
     beneath it — so the record reads "went to OSA, came back, went to OSA
     again" instead of quietly erasing the first attempt. */
  function isRepeatOf(l, s) {
    var i = l.stops.indexOf(s);
    var prev = i > 0 ? l.stops[i - 1] : null;
    return !!prev && wasReturned(prev) && sameDesk(prev, s);
  }

  function sentBackAwaitingRelodge(l) {
    var s = currentStop(l);
    return !!s && !s.receivedAt && isRepeatOf(l, s);
  }

  function stopState(s) {
    if (!s) return 'done';
    if (s.releasedAt) {
      if (wasReturned(s)) return 'returned';
      // Noted is not the same as signed, and the trail should not pretend it is.
      return s.outcome === 'Noted' ? 'noted' : 'released';
    }
    if (s.receivedAt) return 'received';
    return 'waiting';
  }

  // How long it has sat at the office currently holding it.
  function daysAtCurrent(l) {
    var s = currentStop(l);
    if (!s || !s.receivedAt) return 0;
    return Math.max(0, U.daysBetween(s.receivedAt, U.today()));
  }

  function isStuck(l) {
    if (!l || l.status !== 'Routing') return false;
    var s = currentStop(l);
    if (!s) return false;
    // Sent back and not yet handed in again: somebody has to act, so it counts
    // from the day it came back rather than after a grace period.
    if (sentBackAwaitingRelodge(l)) return true;
    if (!s.receivedAt) return false;
    return daysAtCurrent(l) > stopTurnaround(s);
  }

  function isLetterOverdue(l) {
    return !!l && l.status === 'Routing' && !!l.deadline && l.deadline < U.today();
  }

  function letterNeedsAttention(l) { return isStuck(l) || isLetterOverdue(l); }

  // One sentence: where it is, and since when.
  function letterWhere(l) {
    if (!l) return '';
    if (l.status === 'Approved') return 'Approved';
    if (l.status === 'Declined') return 'Declined';
    if (l.status === 'Withdrawn') return 'Withdrawn';

    var s = currentStop(l);
    if (!s) return 'Approved';
    var name = stopName(s);
    if (!s.receivedAt) {
      if (isRepeatOf(l, s)) return 'Returned by ' + name + ' — needs revising';
      var moved = l.stops.some(function (x) { return !!x.releasedAt; });
      return moved ? 'On its way to ' + name : 'Not yet sent — for ' + name;
    }
    var d = daysAtCurrent(l);
    return 'With ' + name + ' — ' + (d === 0 ? 'received today' : U.plural(d, 'day') + ' ago');
  }

  /* Offices cleared, out of offices on the route.

     A return is a second run at the same desk, not an extra desk, so it is left
     out of both halves — otherwise a letter that came back once could never
     reach 100% however many signatures it collected afterwards. */
  function letterProgress(l) {
    var live = l.stops.filter(function (s) { return !wasReturned(s); });
    var done = live.filter(function (s) { return !!s.releasedAt; }).length;
    return { done: done, total: live.length, percent: U.pct(done, live.length) };
  }

  /* ---------- recording the hand-over ---------- */

  /* What a hand-over may be recorded against, checked where the record is kept
     rather than trusted to the screen.

     The screen only offers "Record hand-over" on the desk currently holding the
     letter — but a dialog can be left open while the letter changes underneath
     it: another officer's release arriving by sync, a withdrawal from another
     phone. Pressing Save on that dialog used to go straight through, and the
     store had no opinion. So it could:

       receive a desk further down the route while an earlier one still held it
       receive a desk that had already signed — wiping the signature, and turning
         an approved letter back into one still routing
       bring a withdrawn or declined letter back onto the route
       record a letter coming back before the day it was handed in

     Each of those is now refused with a sentence that says what happened, and
     the dialog shows it. */
  function onRoute(l, s, verb) {
    if (l.status !== 'Routing') {
      throw new Error('This letter is already ' + l.status.toLowerCase() +
        ' \u2014 there is nothing to ' + verb + '. Close this and look again.');
    }
    if (s.releasedAt) {
      throw new Error(stopName(s) + ' has already recorded its outcome. Close this and look again.');
    }
    if (currentStop(l) !== s) {
      throw new Error('This letter is not with ' + stopName(s) + ' yet \u2014 it is ' +
        letterWhere(l).charAt(0).toLowerCase() + letterWhere(l).slice(1) + '.');
    }
  }

  function receiveStop(lid, stopId, data) {
    var l = letter(lid);
    if (!l) return null;
    assertOpen('letter', l);
    var s = l.stops.filter(function (x) { return x.id === stopId; })[0];
    if (!s) return null;
    onRoute(l, s, 'record');
    /* Who took it in, where anybody knows. It used to be required, and requiring
       it is what made walking a letter round a typing exercise: the person at
       the counter rarely gives a name, and an executive who does not have one
       could not record the hand-over at all. The office itself is the honest
       answer when no name was given. */
    var who = str(data.receivedBy, LIMITS.name) || stopName(s);
    s.receivedBy = who;
    s.forwardedBy = str(data.forwardedBy, LIMITS.name);
    s.receivedAt = dateOnly(data.receivedAt) || U.today();
    s.releasedAt = '';
    s.outcome = '';
    l.status = 'Routing';
    l.updatedAt = bumpStamp(l.updatedAt);
    commit();
    return l;
  }

  function releaseStop(lid, stopId, data) {
    var l = letter(lid);
    if (!l) return null;
    assertOpen('letter', l);
    var s = l.stops.filter(function (x) { return x.id === stopId; })[0];
    if (!s) return null;
    onRoute(l, s, 'record');
    if (!s.receivedAt) throw new Error('Record that the office received it first.');
    var when = dateOnly(data.releasedAt) || U.today();
    if (when < s.receivedAt) {
      throw new Error('That is before ' + stopName(s) + ' received it (' +
        U.fmtDateShort(s.receivedAt) + '). Check the date.');
    }
    s.outcome = oneOf(data.outcome, STOP_OUTCOMES, 'Approved');
    s.releasedAt = when;
    s.note = str(data.note, LIMITS.reason);

    /* Sent back for revision. The return stays exactly as recorded and a fresh
       attempt at the same office is opened directly beneath it, so the trail
       shows both passes and the reason it came back is still readable. */
    if (wasReturned(s)) {
      var at = l.stops.indexOf(s);
      l.stops.splice(at + 1, 0, respawn(s));
      l.status = 'Routing';
    } else {
      l.status = currentStop(l) ? 'Routing' : 'Approved';
    }

    l.updatedAt = bumpStamp(l.updatedAt);
    commit();
    return l;
  }

  /* Handed in and answered on the same day, which is most of them: one step
     rather than two dialogs. */
  function passStop(lid, stopId, data) {
    data = data || {};
    var l = letter(lid);
    if (!l) return null;
    assertOpen('letter', l);
    var s = l.stops.filter(function (x) { return x.id === stopId; })[0];
    if (!s) return null;
    if (!s.receivedAt) {
      receiveStop(lid, stopId, {
        receivedBy: data.receivedBy, forwardedBy: data.forwardedBy, receivedAt: data.on
      });
    }
    return releaseStop(lid, stopId, {
      outcome: data.outcome || 'Approved', releasedAt: data.on, note: data.note
    });
  }

  /* The last thing recorded on this letter, undone.

     One tap records a step now, and a tap is a thing people miss: the wrong
     letter, the wrong office, the right office on the wrong day. Without a way
     back, a mis-tap had to be lived with — or the whole letter deleted and
     typed again. This takes back exactly one step and nothing else. */
  function lastStep(l) {
    if (!l) return null;
    var best = null, bestAt = '';
    l.stops.forEach(function (s) {
      if (s.releasedAt && (!best || s.releasedAt >= bestAt)) { best = { stop: s, kind: 'released' }; bestAt = s.releasedAt; }
    });
    if (best) return best;
    for (var i = l.stops.length - 1; i >= 0; i--) {
      if (l.stops[i].receivedAt) return { stop: l.stops[i], kind: 'received' };
    }
    return null;
  }

  function undoLastStep(lid) {
    var l = letter(lid);
    if (!l) return null;
    assertOpen('letter', l);
    var step = lastStep(l);
    if (!step) throw new Error('Nothing has been recorded on this letter yet.');
    var s = step.stop;
    var what;

    if (step.kind === 'released') {
      what = (s.outcome || 'The outcome') + ' at ' + stopName(s);
      /* A return opened a fresh attempt at the same desk beneath it. Undoing
         the return takes that empty attempt away with it, or the letter is left
         pointing at a desk it was never sent back to. */
      var at = l.stops.indexOf(s);
      var nextOne = l.stops[at + 1];
      if (wasReturned(s) && nextOne && sameDesk(nextOne, s) && !nextOne.receivedAt && !nextOne.releasedAt) {
        l.stops.splice(at + 1, 1);
      }
      s.releasedAt = '';
      s.outcome = '';
      s.note = '';
    } else {
      what = 'the hand-over at ' + stopName(s);
      s.receivedAt = '';
      s.receivedBy = '';
      s.forwardedBy = '';
    }

    l.status = 'Routing';
    l.updatedAt = bumpStamp(l.updatedAt);
    commit();
    return { letter: l, undone: what };
  }

  /* Kept for data saved before a return opened its own follow-up entry: it
     simply makes sure there is somewhere for the letter to go next. */
  function reopenStop(lid, stopId) {
    var l = letter(lid);
    if (!l) return null;
    assertOpen('letter', l);
    var s = l.stops.filter(function (x) { return x.id === stopId; })[0];
    if (!s || !wasReturned(s)) return l;
    var at = l.stops.indexOf(s);
    var nextOne = l.stops[at + 1];
    if (!nextOne || !sameDesk(nextOne, s)) {
      l.stops.splice(at + 1, 0, respawn(s));
    }
    l.status = 'Routing';
    l.updatedAt = bumpStamp(l.updatedAt);
    commit();
    return l;
  }

  function setLetterStatus(lid, status) { return updateLetter(lid, { status: status }); }

  // Trouble first, then whatever is due soonest.
  function byLetterUrgency(a, b) {
    var ao = a.status === 'Routing' ? 0 : 1, bo = b.status === 'Routing' ? 0 : 1;
    if (ao !== bo) return ao - bo;
    var as = letterNeedsAttention(a) ? 0 : 1, bs = letterNeedsAttention(b) ? 0 : 1;
    if (as !== bs) return as - bs;
    var ad = a.deadline || '9999-12-31', bd = b.deadline || '9999-12-31';
    if (ad !== bd) return ad < bd ? -1 : 1;
    return a.subject.localeCompare(b.subject);
  }

  function letterStats(list) {
    var s = { total: list.length, routing: 0, approved: 0, stuck: 0, overdue: 0 };
    list.forEach(function (l) {
      if (l.status === 'Routing') s.routing++;
      if (l.status === 'Approved') s.approved++;
      if (isStuck(l)) s.stuck++;
      if (isLetterOverdue(l)) s.overdue++;
    });
    s.attention = list.filter(letterNeedsAttention).length;
    return s;
  }

  /* ---------- the term ----------

     The National executives declare when the administration ends. From that
     moment every unit is told the date and what it still owes.

     Two things this deliberately does NOT do:

     1. It does not lock anything. Work carries on before the date and after it —
        a deadline is a deadline, not a shutter.
     2. It does not delete anything by itself. When the date has passed and every
        unit has filed, the wipe becomes *available*; a national executive still
        has to press it, and only after downloading a backup. A wrong date or an
        early click must never be able to cost the council its year.

     While any unit is still outstanding the wipe is blocked outright. It can be
     unblocked only by a national executive recording a reason, which is kept. */

  function blankTerm() {
    return {
      endDate: '', note: '', declaredAt: '', declaredBy: '',
      overallLink: '', overallOwned: false, closedAt: '', override: null,
      /* What the closed administration leaves behind: unit names, activity
         titles and the links to their filed reports. Titles and links only — a
         few kilobytes — so the next administration inherits a readable record
         rather than an empty app, without keeping the working data the closing
         was meant to clear. */
      archive: [],
      /* When this was last changed, on the device that changed it. Syncing needs
         it: without a stamp there is nothing to compare, and every round would
         either overwrite a declaration or refuse to carry one. */
      updatedAt: ''
    };
  }

  function cleanTerm(t) {
    if (!t || typeof t !== 'object') return blankTerm();
    var o = blankTerm();
    o.endDate = dateOnly(t.endDate);
    o.note = str(t.note, LIMITS.text);
    o.updatedAt = t.updatedAt ? stamp(t.updatedAt) : '';
    o.declaredAt = t.declaredAt ? stamp(t.declaredAt) : '';
    o.declaredBy = str(t.declaredBy, LIMITS.name);
    o.overallLink = driveLink(t.overallLink);
    o.overallOwned = !!t.overallOwned;
    o.closedAt = t.closedAt ? stamp(t.closedAt) : '';
    o.archive = (Array.isArray(t.archive) ? t.archive : []).map(function (a) {
      if (!a || typeof a !== 'object') return null;
      var name = str(a.unitName, LIMITS.org);
      if (!name) return null;
      return {
        unitId: id(a.unitId, 'unt'),
        unitName: name,
        unitCode: str(a.unitCode, 16),
        complied: !!a.complied,
        events: (Array.isArray(a.events) ? a.events : []).slice(0, 400).map(function (e) {
          var title = str(e && e.title, LIMITS.title);
          if (!title) return null;
          return {
            title: title,
            dateStart: dateOnly(e.dateStart),
            dateEnd: dateOnly(e.dateEnd),
            driveLink: driveLink(e.driveLink),
            driveOwned: !!e.driveOwned
          };
        }).filter(Boolean)
      };
    }).filter(Boolean);

    if (t.override && typeof t.override === 'object') {
      o.override = {
        reason: str(t.override.reason, LIMITS.reason),
        by: str(t.override.by, LIMITS.name),
        at: stamp(t.override.at)
      };
      if (!o.override.reason) o.override = null;
    }
    return o;
  }

  function term() { return state.term; }

  function declareTerm(endDate, opts) {
    opts = opts || {};
    var d = dateOnly(endDate);
    if (!d) throw new Error('Pick the date the term ends.');
    state.term.endDate = d;
    state.term.note = (opts.note || '').trim().slice(0, LIMITS.text);
    state.term.declaredAt = nowISO();
    state.term.declaredBy = (opts.by || '').trim();
    state.term.override = null;
    state.term.updatedAt = bumpStamp(state.term.updatedAt);
    commit();
    return state.term;
  }

  /* Withdrawing a closing date has to travel like declaring one does.

     It used to empty the term and stamp nothing, and both halves of syncing
     ignore a term with no declared date — the push would not send it, and the
     pull would not believe it. So a withdrawal stayed on the phone that made it,
     and the next pull brought the old date straight back: the countdown
     reappeared within twenty seconds of being taken down, on every device
     including the one that took it down. A withdrawn term is now a term with a
     stamp and no date, and syncs as the newer of the two. */
  function withdrawTerm() {
    var prev = state.term.updatedAt;
    state.term = blankTerm();
    state.term.updatedAt = bumpStamp(prev);
    commit();
  }

  function setOverallLink(link, owned) {
    var v = driveLink(link);
    if (link && !v) throw new Error('That needs to be a Google Drive or Docs link.');
    state.term.overallLink = v;
    state.term.overallOwned = !!owned;
    state.term.updatedAt = bumpStamp(state.term.updatedAt);
    commit();
    return state.term;
  }

  function overrideCompliance(reason, by) {
    var r = (reason || '').trim();
    if (r.length < 10) throw new Error('Write down why the outstanding units are being passed over.');
    state.term.override = { reason: r.slice(0, LIMITS.reason), by: (by || '').trim(), at: nowISO() };
    state.term.updatedAt = bumpStamp(state.term.updatedAt);
    commit();
    return state.term;
  }

  /* What a unit still owes. An activity is settled when it has been marked
     finished AND its accomplishment report has been filed — the Drive link is
     what counts as filed, because the file itself never lives here. */
  function unitCompliance(unitId) {
    /* An activity that was called off is not owed a report. It is kept in the
       year's record as a thing the council decided not to hold, and asking a
       college to file an accomplishment report for it would be asking them to
       write up an afternoon that never happened. */
    var evs = state.events.filter(function (e) {
      return e.unitId === unitId && !isCancelled(e) && !isDirectiveSet(e);
    });
    var outstanding = evs.filter(function (e) {
      var r = report(e.id);
      var finished = e.status === 'Completed' || e.status === 'Archived';
      return !finished || !(r && r.driveLink);
    });
    /* Filed, but on a drive nobody has vouched for. Kept apart from the
       outstanding list because the work is done — what is missing is the promise
       that it will still be there next year. */
    var unvouched = evs.filter(function (e) {
      var r = report(e.id);
      return r && r.driveLink && !r.driveOwned;
    });
    return {
      unitId: unitId,
      events: evs.length,
      filed: evs.length - outstanding.length,
      outstanding: outstanding,
      unvouched: unvouched,
      complies: outstanding.length === 0 && unvouched.length === 0
    };
  }

  function compliance() {
    return units({ activeOnly: true }).map(function (u) {
      var c = unitCompliance(u.id);
      c.unit = u;
      return c;
    });
  }

  /* Where the term stands, in one object the screens can read without doing
     any arithmetic of their own. */
  function termStatus() {
    var t = state.term;
    if (!t.endDate) return { declared: false, closed: false };

    var daysLeft = U.daysBetween(U.today(), t.endDate);
    var rows = compliance();
    var short = rows.filter(function (c) { return !c.complies; });
    var atRisk = rows.reduce(function (n, c) { return n + c.unvouched.length; }, 0);

    return {
      declared: true,
      closed: !!t.closedAt,
      endDate: t.endDate,
      note: t.note,
      daysLeft: daysLeft,
      passed: daysLeft < 0,
      // Everyone has filed, or an executive has recorded a reason to proceed.
      allFiled: short.length === 0,
      overridden: !!t.override,
      outstandingUnits: short,
      compliance: rows,
      // Reports filed to a drive nobody has vouched for. These are what rot.
      atRisk: atRisk,
      // The wipe is offered only once the date has gone by and nothing is owed.
      canClose: daysLeft < 0 && (short.length === 0 || !!t.override) && !t.closedAt,
      blockedBy: daysLeft < 0 && short.length > 0 && !t.override ? short : []
    };
  }

  /* The record of the year a closed term leaves behind: unit names, activity
     titles and where each report was filed. Built by the real close and by the
     preview alike, so what the preview shows is exactly what the close keeps.

     Every unit that did any work, not only the ones still switched on — a
     college deactivated during the year would otherwise lose its record
     entirely, its activities deleted and nothing kept to say they happened. */
  function buildArchive() {
    return units().filter(function (u) {
      return state.events.some(function (e) {
        return e.unitId === u.id && !isDirectiveSet(e);
      });
    }).map(function (u) {
      var c = unitCompliance(u.id);
      return {
        unitId: u.id, unitName: u.name, unitCode: u.code, complied: c.complies,
        events: state.events.filter(function (e) {
          return e.unitId === u.id && !isDirectiveSet(e);
        }).map(function (e) {
          var r = report(e.id);
          return {
            title: e.title, dateStart: e.dateStart, dateEnd: e.dateEnd,
            /* An activity the council called off is part of the year too, and
               the record has to say which it was — otherwise it reads as one
               that was simply never filed. */
            cancelled: isCancelled(e), cancelReason: e.cancelReason || '',
            driveLink: r ? r.driveLink : '', driveOwned: !!(r && r.driveOwned)
          };
        })
      };
    });
  }

  /* What closing the term would do, without doing any of it.

     Asked for by a council that wanted to try the end of term before October —
     which, once closing genuinely deletes the year for everybody, is not
     something that can be tried on the real button. This reads everything and
     changes nothing: not the store, not the term, not the server. */
  function closePreview() {
    var st = termStatus();
    var why = '';
    if (!st.declared) why = 'No closing date has been declared yet.';
    else if (st.closed) why = 'This term has already been closed.';
    else if (!st.passed) why = 'The closing date, ' + U.fmtDate(st.endDate) + ', has not arrived.';
    else if (st.outstandingUnits.length && !st.overridden) {
      why = U.plural(st.outstandingUnits.length, 'unit') +
        (st.outstandingUnits.length === 1 ? ' has' : ' have') + ' not filed yet.';
    }

    var sealed = units().filter(function (u) { return INDEPENDENT_KINDS.indexOf(u.kind) >= 0; });
    return {
      allowed: !!st.canClose,
      why: why,
      endDate: st.declared ? st.endDate : '',
      deletes: {
        events: state.events.length,
        tasks: state.tasks.length,
        letters: state.letters.length,
        reports: state.reports.length,
        people: state.people.length
      },
      archive: buildArchive(),
      keeps: {
        units: state.units.length,
        offices: state.offices.length,
        letterhead: !!state.org.letterhead,
        overallLink: state.term.overallLink || ''
      },
      /* The sealed bodies' work is not on a national officer's phone at all, so
         this phone cannot delete it. Said here rather than discovered later. */
      sealed: sealed.map(function (u) { return u.name; })
    };
  }

  /* Closing the term. Everything the administration did is removed so the next
     one starts clean; the units, the letterhead and the link to the overall
     report are what carry over — the report itself lives in Drive, which is why
     a link was the right thing to keep all along.

     It used to remove all of that from the phone that pressed the button and
     nowhere else. It wrote no deletions, so the server kept every row and no
     other phone was told anything — and because a cleared phone asks the server
     for everything, the next sync brought the whole year straight back onto the
     phone that had closed it. Closing the term looked like it worked, for about
     twenty seconds.

     Now every record it removes is recorded as deleted, the same way deleting
     one activity is. That is what reaches the database and every other phone. */
  function closeTerm(opts) {
    opts = opts || {};
    var st = termStatus();
    if (!st.declared) throw new Error('No closing date has been declared.');
    if (!st.canClose) {
      throw new Error(st.passed
        ? 'Some units have not filed yet, so nothing can be deleted.'
        : 'The term has not reached its closing date.');
    }

    var keepUnits = state.units;
    var keepOffices = state.offices;
    var keepOrg = state.org;
    /* The record of the year, taken before anything is removed. */
    var keepTerm = cleanTerm(state.term);
    keepTerm.closedAt = nowISO();
    keepTerm.updatedAt = bumpStamp(keepTerm.updatedAt);
    keepTerm.archive = buildArchive();
    if (opts.overallLink) keepTerm.overallLink = driveLink(opts.overallLink) || keepTerm.overallLink;

    // What is about to go, by kind, so each can be recorded as deleted.
    var going = {
      event: state.events.map(function (e) { return e.id; }),
      task: state.tasks.map(function (t) { return t.id; }),
      letter: state.letters.map(function (l) { return l.id; }),
      report: state.reports.map(function (r) { return r.id; }),
      person: state.people.map(function (p) { return p.id; }),
      announcement: state.announcements.map(function (a) { return a.id; }),
      ack: state.acks.map(function (k) { return k.id; })
    };
    var reportIds = going.report.slice();
    /* Setup that outlives an administration: the templates a unit reuses and
       the record of which academic years are closed. */
    var keepTemplates = state.templates;
    var keepYears = state.years;
    var keepStartMonth = state.yearStartMonth;

    /* Kept as well, because none of it is the year's work: the council's own
       lists of positions and committees; the deletions already made, which the
       server may still be holding rows for; and where syncing had got to, so
       the next sync sends the deletions instead of downloading the year again. */
    var keepDeleted = state.deleted;
    var keepSync = state.sync;
    var keepPositions = state.positions;
    var keepCommittees = state.committees;
    var keepCouncilAt = state.councilAt;

    state = blank();
    state.units = keepUnits;
    state.offices = keepOffices;
    state.org = keepOrg;
    state.term = keepTerm;
    state.deleted = keepDeleted || {};
    state.sync = keepSync || state.sync;
    state.positions = keepPositions || state.positions;
    state.committees = keepCommittees || state.committees;
    state.councilAt = keepCouncilAt || '';
    state.templates = keepTemplates || [];
    state.years = keepYears || [];
    state.yearStartMonth = keepStartMonth || 6;
    state.seeded = true;

    /* A deletion that is not recorded is a deletion nobody else hears of. */
    var at = nowISO();
    Object.keys(going).forEach(function (kind) {
      if (!state.deleted[kind]) state.deleted[kind] = {};
      going[kind].forEach(function (rid) { state.deleted[kind][rid] = at; });
    });

    commit();

    if (global.AssetDB) {
      reportIds.forEach(function (id) { global.AssetDB.delPrefix(id + ':'); });
    }
    try { global.localStorage.removeItem(PERSON_KEY); } catch (e) { /* nothing to clear */ }
    return keepTerm;
  }

  /* ---------- letter templates ---------- */

  function org() { return state.org; }

  /* The template a unit's reports are printed on: its own where it has one, the
     Republic's otherwise. Everything that prints asks this rather than reading
     org.letterhead directly, so adding a college's own template needed no
     change anywhere a report is made. */
  function templateFor(unitId) {
    var u = unit(unitId);
    if (u && u.letterhead) return u.letterhead;
    return state.org.letterhead || '';
  }

  function setUnitTemplate(unitId, data) {
    var u = unit(unitId);
    if (!u) return null;
    var lh = letterhead(data.letterhead);
    if (data.letterhead && !lh) {
      if (global.UI) {
        global.UI.toast('That template could not be used — PNG or JPG, under 3 MB.', 'error');
      }
      return u;
    }
    u.letterhead = lh;
    u.letterheadBy = lh ? str(data.letterheadBy, LIMITS.name) : '';
    u.letterheadAt = lh ? nowISO() : '';
    u.updatedAt = bumpStamp(u.updatedAt);
    commit();
    return u;
  }

  function updateOrg(data) {
    ['name', 'address', 'email'].forEach(function (k) {
      if (k in data) state.org[k] = str(data[k], LIMITS.org);
    });
    if ('letterhead' in data) {
      var lh = letterhead(data.letterhead);
      if (data.letterhead && !lh) {
        if (global.UI) {
          global.UI.toast('That letterhead could not be used — PNG or JPG, under 3 MB.', 'error');
        }
        return state.org;
      }
      state.org.letterhead = lh;
      state.org.letterheadBy = str(data.letterheadBy, LIMITS.name);
      state.org.letterheadAt = lh ? nowISO() : '';
    }

    // An uploaded emblem goes through the same check as a restored one.
    if ('emblem' in data) {
      var img = emblem(data.emblem);
      if (data.emblem && !img) {
        if (global.UI) global.UI.toast('That image could not be used — PNG or JPG only.', 'error');
        return state.org;
      }
      state.org.emblem = img;
    }
    touchCouncil();
    commit();
    return state.org;
  }

  /* ---------- an activity and its tasks, in one save ---------- */

  /* Used by templates and by duplicating: the activity, then every task that
     belongs to it, then a single write. `tasks` is a list of task fields; the
     activity's id is filled in here. */
  function createEventWithTasks(data, taskList) {
    var e = buildEvent(data);
    var made = (taskList || []).map(function (td) {
      var copy = {};
      Object.keys(td || {}).forEach(function (k) { copy[k] = td[k]; });
      copy.eventId = e.id;
      copy.eventReady = true;
      copy.kind = 'event';
      return buildTask(copy);
    });
    state.events.push(e);
    made.forEach(function (t) { state.tasks.push(t); });
    commit();
    return { event: e, tasks: made };
  }

  /* ---------- duplicating an activity ----------

     Teachers' Day, the Founders' activities, Christian Emphasis Week: the same
     activity every year, set up from nothing every year. A copy starts as a
     fresh record — nothing about how the last one went comes with it: no
     finished statuses, no completion dates, no report, no letters, no
     feedback responses. Only the shape of the work. */
  function duplicateEvent(sourceId, opts) {
    opts = opts || {};
    var src = event(sourceId);
    if (!src) throw new Error('That activity is no longer here.');
    var title = String(opts.title || '').trim();
    if (!title) throw new Error('Give the new activity a title.');
    var start = dateOnly(opts.dateStart);
    if (!start && !isDirectiveSet(src)) throw new Error('Pick the new date.');

    // How far the whole thing moves, so each task lands the same distance from the day.
    var shift = src.dateStart && start ? U.daysBetween(src.dateStart, start) : 0;
    var length = src.dateStart && src.dateEnd ? U.daysBetween(src.dateStart, src.dateEnd) : 0;
    var settings = opts.includeSettings !== false;

    var data = {
      kind: src.kind, title: title,
      // Copying another unit's activity makes one for your own unit.
      unitId: opts.unitId && unit(opts.unitId) ? opts.unitId : src.unitId,
      dateStart: start,
      dateEnd: start && length > 0 ? U.addDays(start, length) : '',
      description: settings ? src.description : '',
      venue: settings ? src.venue : '',
      headId: settings && src.headId && person(src.headId) && person(src.headId).active !== false
        ? src.headId : '',
      status: 'Upcoming',
      feedbackRequired: settings ? src.feedbackRequired !== false : true,
      historyNote: 'created this ' + (isDirectiveSet(src) ? 'directive' : 'event') +
        ' as a copy of “' + src.title + '”'
    };

    var list = !opts.includeTasks ? [] : tasks({ eventId: src.id }).map(function (t) {
      var who = opts.keepAssignees !== false && t.assigneeId && person(t.assigneeId) &&
        person(t.assigneeId).active !== false ? t.assigneeId : '';
      return {
        title: t.title, priority: t.priority, remarks: t.remarks, assigneeId: who,
        dueDate: t.dueDate ? (shift ? U.addDays(t.dueDate, shift) : t.dueDate) : '',
        status: 'Not Started'
      };
    });

    var out = createEventWithTasks(data, list);

    /* The same helpers, on the new activity too. Their accounts are untouched;
       they are simply taken on for this one as well. */
    if (opts.includeVolunteers && !isDirectiveSet(src)) {
      volunteersFor(src.id).forEach(function (v) {
        if ((v.eventIds || []).indexOf(out.event.id) < 0) {
          v.eventIds = (v.eventIds || []).concat([out.event.id]).slice(0, 200);
          v.updatedAt = bumpStamp(v.updatedAt);
        }
      });
      commit();
    }
    return out;
  }

  /* ---------- the Bulletin Board ---------- */

  function announcements() {
    return state.announcements.slice().sort(function (a, b) {
      if (!!a.pinned !== !!b.pinned) return a.pinned ? -1 : 1;
      var ap = a.publishAt || a.createdAt, bp = b.publishAt || b.createdAt;
      return ap < bp ? 1 : ap > bp ? -1 : 0;
    });
  }

  function announcement(aid) {
    for (var i = 0; i < state.announcements.length; i++) {
      if (state.announcements[i].id === aid) return state.announcements[i];
    }
    return null;
  }

  /* Where an announcement stands right now. Derived from its dates on every
     read, so it moves from Active to Previous on the day it expires without
     anybody or anything having to move it. */
  function announcementState(a, at) {
    if (!a) return 'gone';
    var now = at || nowISO();
    if (a.published === false) return 'draft';
    if (a.expiresAt && a.expiresAt <= now) return 'expired';
    if (a.publishAt && a.publishAt > now) return 'scheduled';
    return 'active';
  }

  /* Whether an announcement is addressed to somebody. `who` is
     { unitId, national, officer, personId }; the Bulletin screen fills it in
     from whoever is signed in. The database asks the same question before it
     hands the row over at all (workspace.sql); this is so the screens agree. */
  function announcementFor(a, who) {
    if (!a || !who) return false;
    if (who.national) return true;
    var aud = a.audience || {};
    if (aud.kind === 'everyone') return !!who.officer;
    if (aud.kind === 'nationals') return false;
    if (aud.kind === 'units') return !!who.officer && (aud.unitIds || []).indexOf(who.unitId) >= 0;
    if (aud.kind === 'people') return !!who.personId && (aud.personIds || []).indexOf(who.personId) >= 0;
    return false;
  }

  /* Only the FCUSR Nationals publish to the Bulletin Board. Asked here as well
     as on the screen, so a button left showing by mistake still cannot write;
     the database refuses it a third time. */
  function mayPublish() {
    return !global.Auth || !Auth.canPublishBulletin || Auth.canPublishBulletin();
  }

  function announcementFields(a, data) {
    ['title'].forEach(function (k) { if (k in data) a[k] = data[k]; });
    if ('message' in data) a.message = data.message;
    if ('audience' in data) a.audience = data.audience;
    if ('priority' in data) a.priority = data.priority;
    if ('published' in data) a.published = !!data.published;
    if ('publishAt' in data) a.publishAt = data.publishAt;
    if ('expiresAt' in data) a.expiresAt = data.expiresAt;
    if ('link' in data) a.link = data.link;
    if ('pinned' in data) a.pinned = !!data.pinned;
    if ('requireAck' in data) a.requireAck = !!data.requireAck;
  }

  function checkAnnouncement(a) {
    if (!a) throw new Error('Give the announcement a title.');
    if (a.expiresAt && a.publishAt && a.expiresAt <= a.publishAt) {
      throw new Error('It cannot expire before it is published.');
    }
    if (a.audience.kind === 'units' && !a.audience.unitIds.length) {
      throw new Error('Choose at least one unit to send it to.');
    }
    if (a.audience.kind === 'people' && !a.audience.personIds.length) {
      throw new Error('Choose at least one person to send it to.');
    }
  }

  function addAnnouncement(data) {
    if (!mayPublish()) throw new Error('Only FCUSR Nationals can post to the Bulletin Board.');
    var raw = {
      id: U.uid('ann'),
      unitId: (global.Auth && Auth.signedIn() && Auth.myUnitId()) || nationalUnitId(),
      published: true, publishAt: nowISO(),
      createdBy: actorName(), history: [],
      createdAt: nowISO(), updatedAt: nowISO()
    };
    announcementFields(raw, data);
    var a = cleanAnnouncement(raw);
    checkAnnouncement(a);
    logOn(a, 'announcement', a.published ? (a.publishAt > nowISO() ? 'scheduled it' : 'published it')
                                         : 'saved it as a draft');
    state.announcements.push(a);
    commit();
    return a;
  }

  function updateAnnouncement(aid, data) {
    if (!mayPublish()) throw new Error('Only FCUSR Nationals can change the Bulletin Board.');
    var a = announcement(aid);
    if (!a) return null;
    assertOpen('announcement', a);
    var was = { published: a.published, pinned: a.pinned, title: a.title };
    var copy = JSON.parse(JSON.stringify(a));
    announcementFields(copy, data);
    var clean = cleanAnnouncement(copy);
    checkAnnouncement(clean);
    if (!was.published && clean.published) logOn(clean, 'announcement', 'published it');
    else if (was.published && !clean.published) logOn(clean, 'announcement', 'took it back to a draft');
    if (was.pinned !== clean.pinned) logOn(clean, 'announcement', clean.pinned ? 'pinned it' : 'unpinned it');
    if (('title' in data || 'message' in data || 'audience' in data || 'expiresAt' in data) &&
        !('pinned' in data && Object.keys(data).length === 1)) {
      logOn(clean, 'announcement', 'edited it');
    }
    clean.updatedAt = bumpStamp(a.updatedAt);
    state.announcements[state.announcements.indexOf(a)] = clean;
    commit();
    return clean;
  }

  function deleteAnnouncement(aid) {
    if (!mayPublish()) throw new Error('Only FCUSR Nationals can remove an announcement.');
    var a = announcement(aid);
    if (!a) return false;
    assertOpen('announcement', a);
    tombstone('announcement', aid);
    state.announcements = state.announcements.filter(function (x) { return x.id !== aid; });
    // The server drops its acknowledgements with it; this device does the same.
    state.acks = state.acks.filter(function (k) { return k.announcementId !== aid; });
    commit();
    return true;
  }

  function acks(aid) {
    return state.acks.filter(function (k) { return !aid || k.announcementId === aid; });
  }

  function hasAcked(aid, profileId) {
    if (!aid || !profileId) return false;
    return state.acks.some(function (k) { return k.announcementId === aid && k.profileId === profileId; });
  }

  /* "I have read this." Recorded against the account, not the directory entry:
     it is the person at the screen who read it, and the account is what the
     database can check is really them. */
  function acknowledge(aid) {
    var a = announcement(aid);
    if (!a) throw new Error('That announcement is no longer on the board.');
    var who = global.Auth && Auth.signedIn() ? Auth.current() : null;
    var profileId = who ? who.id : 'local';
    if (hasAcked(aid, profileId)) return null;
    var k = cleanAck({
      id: U.hashUuid(aid + '|' + profileId),
      announcementId: aid, profileId: profileId,
      email: who ? who.email : '', name: who ? who.name : 'This device',
      at: nowISO(), createdAt: nowISO(), updatedAt: nowISO()
    });
    state.acks.push(k);
    commit();
    return k;
  }

  /* Everybody an announcement is addressed to who could possibly read it: the
     people with a sign-in, in the audience, still active. The directory is the
     roll; somebody with no login has no way to press the button, so counting
     them would leave the number short for ever. */
  function announcementRoll(a) {
    if (!a) return [];
    var aud = a.audience || {};
    return state.people.filter(function (p) {
      if (p.active === false || !p.email) return false;
      if (aud.kind === 'people') return (aud.personIds || []).indexOf(p.id) >= 0;
      if (p.access !== 'officer') return false;
      var u = unit(p.unitId);
      if (aud.kind === 'nationals') return !!u && u.kind === 'national';
      if (aud.kind === 'units') return (aud.unitIds || []).indexOf(p.unitId) >= 0;
      return true;
    }).sort(function (x, y) { return x.name.localeCompare(y.name); });
  }

  /* Who has and has not read it, matched by the address their account was made
     with — the one thing the directory and the account agree on. */
  function ackStatus(aid) {
    var a = announcement(aid);
    var roll = announcementRoll(a);
    var byMail = {};
    acks(aid).forEach(function (k) { if (k.email) byMail[k.email] = k; });
    var done = [], waiting = [];
    roll.forEach(function (p) {
      if (byMail[p.email]) done.push({ person: p, ack: byMail[p.email] });
      else waiting.push({ person: p });
    });
    return { total: roll.length, done: done, waiting: waiting, count: acks(aid).length };
  }

  /* ---------- event templates ---------- */

  function templates(opts) {
    opts = opts || {};
    return state.templates.filter(function (t) {
      if (!opts.includeArchived && t.archived) return false;
      // What a unit may use: its own, and the ones shared across the Republic.
      if (opts.usableBy) return t.shared || t.unitId === opts.usableBy;
      return true;
    }).sort(function (a, b) { return a.name.localeCompare(b.name); });
  }

  function template(tid) {
    for (var i = 0; i < state.templates.length; i++) if (state.templates[i].id === tid) return state.templates[i];
    return null;
  }

  function mayEditTemplate(t) {
    return !global.Auth || !Auth.canEditTemplate || Auth.canEditTemplate(t);
  }

  function addTemplate(data) {
    var raw = {
      id: U.uid('tpl'),
      unitId: data.unitId || (global.Auth && Auth.signedIn() && Auth.myUnitId()) || nationalUnitId(),
      name: data.name, description: data.description, venue: data.venue,
      durationDays: data.durationDays, feedbackRequired: data.feedbackRequired,
      volunteers: data.volunteers, tasks: data.tasks, shared: !!data.shared,
      createdBy: actorName(), history: [],
      createdAt: nowISO(), updatedAt: nowISO()
    };
    var t = cleanTemplate(raw);
    if (!t) throw new Error('Give the template a name.');
    if (!mayEditTemplate(t)) {
      throw new Error(t.shared ? 'Only FCUSR Nationals can share a template with every unit.'
                               : 'You cannot add templates for that unit.');
    }
    logOn(t, 'template', data.historyNote || 'made this template');
    state.templates.push(t);
    commit();
    return t;
  }

  function updateTemplate(tid, data) {
    var t = template(tid);
    if (!t) return null;
    if (!mayEditTemplate(t)) throw new Error('That template belongs to another unit.');
    var copy = JSON.parse(JSON.stringify(t));
    ['name', 'description', 'venue', 'durationDays', 'feedbackRequired', 'volunteers',
     'tasks', 'shared', 'archived'].forEach(function (k) { if (k in data) copy[k] = data[k]; });
    var clean = cleanTemplate(copy);
    if (!clean) throw new Error('Give the template a name.');
    if (!mayEditTemplate(clean)) throw new Error('Only FCUSR Nationals can share a template with every unit.');
    if (t.archived !== clean.archived) logOn(clean, 'template', clean.archived ? 'archived it' : 'brought it back');
    else if (t.name !== clean.name) logOn(clean, 'template', 'renamed it to “' + clean.name + '”');
    else logOn(clean, 'template', 'edited it');
    clean.updatedAt = bumpStamp(t.updatedAt);
    state.templates[state.templates.indexOf(t)] = clean;
    commit();
    return clean;
  }

  function deleteTemplate(tid) {
    var t = template(tid);
    if (!t) return false;
    if (!mayEditTemplate(t)) throw new Error('That template belongs to another unit.');
    tombstone('template', tid);
    state.templates = state.templates.filter(function (x) { return x.id !== tid; });
    commit();
    return true;
  }

  /* An activity that went well, kept as the starting point for the next one.
     Its tasks become the list, each at the same distance from the day. */
  function templateFromEvent(eventId, data) {
    var e = event(eventId);
    if (!e) throw new Error('That activity is no longer here.');
    return addTemplate({
      name: data.name || e.title, description: e.description, venue: e.venue,
      durationDays: e.dateStart && e.dateEnd ? U.daysBetween(e.dateStart, e.dateEnd) + 1 : 1,
      feedbackRequired: e.feedbackRequired !== false,
      volunteers: volunteersFor(e.id).length > 0,
      shared: !!data.shared, unitId: data.unitId,
      historyNote: 'made this template from “' + e.title + '”',
      tasks: tasks({ eventId: e.id }).map(function (t) {
        return {
          title: t.title, priority: t.priority,
          offsetDays: e.dateStart && t.dueDate ? U.daysBetween(e.dateStart, t.dueDate) : 0
        };
      })
    });
  }

  /* ---------- academic years ---------- */

  function mayManageYears() {
    return !global.Auth || !Auth.canManageYears || Auth.canManageYears();
  }

  /* The current year first, then the archived ones, newest first. */
  function years() {
    return [currentYear()].concat(state.years.slice().reverse());
  }

  function yearCounts(yid) {
    var inYear = function (kind) { return function (r) { return yearOf(kind, r) === yid; }; };
    var evs = state.events.filter(inYear('event'));
    return {
      events: evs.filter(function (e) { return !isDirectiveSet(e); }).length,
      directives: evs.filter(isDirectiveSet).length +
        state.tasks.filter(function (t) { return (t.kind || 'event') === 'directive'; })
          .filter(inYear('task')).length,
      tasks: state.tasks.filter(function (t) { return (t.kind || 'event') === 'event'; })
        .filter(inYear('task')).length,
      letters: state.letters.filter(inYear('letter')).length,
      announcements: state.announcements.filter(inYear('announcement')).length,
      reports: state.reports.filter(inYear('report')).length
    };
  }

  /* Closing an academic year. Nothing is deleted, copied or moved: the year is
     written down as archived, and every record dated inside it becomes
     read-only and leaves the working screens. The next year starts the day
     after. It can be opened again for corrections, and the latest one can be
     returned to current altogether. */
  function archiveYear(opts) {
    opts = opts || {};
    if (!mayManageYears()) throw new Error('Only the President can close an academic year.');
    var cur = currentYear();
    var end = dateOnly(opts.end);
    if (!end) throw new Error('Pick the last day of the year being closed.');
    if (end > U.today()) throw new Error('A year can only be closed on or after its last day.');
    /* The first year ever closed reaches back to the beginning, so it can end
       anywhere. After that, a year starts the day after the last one ended. */
    var first = !state.years.length;
    if (!first && end < cur.start) {
      throw new Error('That is before this year began (' + U.fmtDateShort(cur.start) + ').');
    }
    var y = cleanYears([{
      start: first ? '' : cur.start, end: end,
      note: opts.note || '', archivedAt: nowISO(), archivedBy: actorName()
    }])[0];
    y.label = yearLabel(first ? '' : cur.start, end);
    state.years.push(y);
    state.years = cleanYears(state.years);
    touchCouncil();
    commit();
    return y;
  }

  /* Opened for corrections, for a set time, and closed again by itself. */
  function unlockYear(yid, minutes) {
    if (!mayManageYears()) throw new Error('Only the President can reopen an archived year.');
    var y = archivedYear(yid);
    if (!y) return null;
    y.unlockedUntil = new Date(Date.now() + (minutes || 30) * 60000).toISOString();
    y.unlockedBy = actorName();
    touchCouncil();
    commit();
    return y;
  }

  function lockYear(yid) {
    if (!mayManageYears()) throw new Error('Only the President can close an archived year.');
    var y = archivedYear(yid);
    if (!y) return null;
    y.unlockedUntil = '';
    touchCouncil();
    commit();
    return y;
  }

  /* Undoing the most recent close entirely: its records are current again.
     Only the latest, so no year is ever left with a gap in the middle. */
  function restoreYear(yid) {
    if (!mayManageYears()) throw new Error('Only the President can return a year to current.');
    var last = state.years[state.years.length - 1];
    if (!last || last.id !== yid) throw new Error('Only the most recently archived year can be returned.');
    state.years.pop();
    touchCouncil();
    commit();
    return true;
  }

  function setYearStartMonth(m) {
    if (!mayManageYears()) throw new Error('Only the President can change when the year starts.');
    state.yearStartMonth = startMonth(m);
    touchCouncil();
    commit();
    return state.yearStartMonth;
  }

  /* ---------- reading the history ---------- */

  /* An activity's history is its own lines and every line its tasks carry,
     together, newest first — "who did what to this activity" is one question. */
  function historyFor(kind, rid) {
    var rows = [];
    var add = function (list, where) {
      (list || []).forEach(function (h) { rows.push({ at: h.at, by: h.by, text: h.text, where: where || '' }); });
    };
    if (kind === 'event') {
      var e = event(rid);
      if (!e) return [];
      add(e.history);
      tasks({ eventId: rid }).forEach(function (t) { add(t.history); });
    } else if (kind === 'task') {
      var t2 = task(rid);
      if (t2) add(t2.history);
    } else if (kind === 'announcement') {
      var a = announcement(rid);
      if (a) add(a.history);
    } else if (kind === 'person') {
      var p = person(rid);
      if (p) add(p.history);
    } else if (kind === 'template') {
      var tp = template(rid);
      if (tp) add(tp.history);
    }
    return rows.sort(function (x, y) { return x.at < y.at ? 1 : x.at > y.at ? -1 : 0; });
  }

  /* ---------- backup ---------- */

  function toJSON() {
    return JSON.stringify({
      app: 'FCUSR Task Tracker',
      version: 1,
      exportedAt: nowISO(),
      data: state
    }, null, 2);
  }

  function fromJSON(text) {
    var parsed = JSON.parse(text);
    var data = parsed && parsed.data ? parsed.data : parsed;
    if (!data || (!Array.isArray(data.events) && !Array.isArray(data.tasks) && !Array.isArray(data.people))) {
      throw new Error('That file does not look like an FCUSR Task Tracker backup.');
    }
    state = normalize(data);
    commit();
    return {
      people: state.people.length,
      events: state.events.length,
      tasks: state.tasks.length
    };
  }

  // Wipes people, events and tasks. The letterhead is setup, not tracker data, so it stays.
  /* Take the council's work off this device, without telling anyone it was
     deleted.

     resetAll() is somebody deciding to wipe the tracker; this is a different
     act with the same shape. It leaves no tombstones, because nothing has been
     deleted from the council — the work is on the server and this device is
     simply no longer holding a copy. The marks go with it so the next person to
     sign in pulls their own. */
  function clearLocalCopy() {
    var reportIds = state.reports.map(function (r) { return r.id; });
    var keepOrg = state.org;
    var keepUnits = state.units;
    var keepOffices = state.offices;
    var keepYears = state.years;
    var keepStartMonth = state.yearStartMonth;

    state = blank();
    state.org = keepOrg;
    state.units = keepUnits;
    state.offices = keepOffices;
    // Which years are closed is the Republic's setup, not the last person's work.
    state.years = keepYears;
    state.yearStartMonth = keepStartMonth;
    state.seeded = true;          // no rehearsal for whoever signs in next
    /* And whose name My tasks was showing. It lived outside this record and was
       only cleared when a term closed, so on a shared computer the next officer
       to sign in opened somebody else's task list under somebody else's name. */
    try { global.localStorage.removeItem(PERSON_KEY); } catch (e) { /* nothing to clear */ }
    commit();

    // Photographs are held outside this record and are the largest thing here.
    if (global.AssetDB) {
      reportIds.forEach(function (id) { global.AssetDB.delPrefix(id + ':'); });
    }
  }

  function resetAll() {
    var keepOrg = state.org;
    var keepUnits = state.units;
    var keepOffices = state.offices;
    var keepTemplates = state.templates;
    var keepYears = state.years;
    var keepStartMonth = state.yearStartMonth;
    state = blank();
    state.org = keepOrg;
    state.units = keepUnits;
    state.offices = keepOffices;
    state.templates = keepTemplates;
    state.years = keepYears;
    state.yearStartMonth = keepStartMonth;
    /* The units, the offices and the letterhead are setup and survive. A closing
       date is not setup — it belongs to the administration being deleted, and so
       does the dry run. */
    state.seeded = true;
    commit();
  }

  /* ---------- seed ---------- */

  /* An invented council, for the tests.

     It is no longer given to anybody: the app opens empty. The suites need
     something to walk through, so they ask for it by name — and the underscore
     is the whole point, because this is not part of what the app does. */
  function _seedRehearsal() {
    seed();
    /* The fixture is loaded deliberately, so it must not be swept away by the
       clearing pass that runs when real data is read back in. */
    ['events', 'tasks', 'letters', 'people', 'reports'].forEach(function (list) {
      state[list].forEach(function (r) { delete r.sample; });
    });
    commit();
    return state;
  }

  function seed() {
    var t = U.today();
    var d = function (n) { return U.addDays(t, n); };

    var roster = [
      /* Five, not a full executive board. This is a rehearsal, and every
         invented name is one more thing to tell apart from a real officer when
         the dry run ends. Five is enough to show work spread across people,
         which is the only thing the sample roster is for. */
      ['Althea Ramirez', 'President', 'Executive'],
      ['Miguel Fortaleza', 'VP–Internal', 'Programs'],
      ['Job Sarmiento', 'Secretary', 'Documentation'],
      ['Kyla Montaño', 'Treasurer', 'Finance'],
      ['Jomar Delgado', 'Business Manager', 'Logistics']
    ];
    var byPos = {};
    roster.forEach(function (r) {
      var p = {
        id: U.uid('per'), name: r[0], position: r[1], committee: r[2],
        email: '', unitId: nationalUnitId(), access: 'officer', eventIds: [], claimed: false,
        active: true, sample: true, createdAt: nowISO(), updatedAt: nowISO()
      };
      state.people.push(p);
      byPos[r[1]] = p.id;
    });

    var evs = [
      {
        title: 'Foundation Week 2026',
        description: 'Week-long university celebration: opening parade, socio-cultural night, and inter-college sports.',
        dateStart: d(26), dateEnd: d(30), venue: 'FCU Gymnasium and Quadrangle',
        headId: byPos['President'], status: 'Upcoming'
      },
      {
        title: 'Leadership Training Seminar',
        description: 'One-day seminar for incoming class officers and organization heads.',
        dateStart: d(9), dateEnd: '', venue: 'Function Hall, Administration Building',
        headId: byPos['VP–Internal'], status: 'Ongoing'
      },
      {
        title: 'Feeding Program — Barangay Culasi',
        description: 'Outreach feeding for 150 children in partnership with the barangay council.',
        dateStart: d(17), dateEnd: '', venue: 'Barangay Culasi Covered Court',
        headId: byPos['VP–Internal'], status: 'Upcoming'
      }
    ];
    var natId = nationalUnitId();
    var evIds = evs.map(function (e) {
      e.id = U.uid('evt');
      e.unitId = natId;
      e.sample = true;
      e.createdAt = nowISO();
      e.updatedAt = bumpStamp(e.updatedAt);
      state.events.push(e);
      return e.id;
    });

    // [event index, title, position, dueOffset, priority, status, remarks]
    var rows = [
      [0, 'Draft and route the activity proposal', 'Secretary', -5, 'High', 'Done', 'Signed by the Dean of Student Affairs.'],
      [0, 'Reserve the covered court for the opening parade', 'Business Manager', -4, 'Medium', 'Done', ''],
      [0, 'Secure gymnasium reservation', 'VP–Internal', -2, 'High', 'In Progress', 'Physical Plant asked for a second copy of the request letter.'],
      [0, 'Confirm the guest speaker', 'President', -3, 'High', 'On hold', ''],
      [0, 'Prepare the program budget', 'Treasurer', 2, 'High', 'In Progress', ''],
      [0, 'Finalize sports event mechanics', 'VP–Internal', 8, 'Medium', 'For Review', 'Sent to the Sports Committee for checking.'],
      [0, 'Design tarpaulin and poster set', 'Secretary', 6, 'Medium', 'Not Started', ''],
      [0, 'Book sound system and lights', 'Business Manager', 13, 'Medium', 'Not Started', ''],

      [1, 'Book the function hall', 'Secretary', -7, 'High', 'Done', ''],
      [1, 'Send invitation letters to resource speakers', 'VP–Internal', -1, 'High', 'In Progress', 'Two of three speakers have replied.'],
      [1, 'Post the registration form and reminder', 'Secretary', 1, 'Medium', 'In Progress', ''],
      [1, 'Prepare seminar kits and handouts', 'Treasurer', 3, 'Medium', 'Not Started', ''],
      [1, 'Arrange snacks and lunch for 60 pax', 'Business Manager', 5, 'Medium', 'Not Started', ''],
      [1, 'Prepare attendance sheets and evaluation forms', '', 7, 'Low', 'Not Started', 'Needs a volunteer from the Documentation Committee.'],

      [2, 'Canvass ingredients and packaging', 'Business Manager', -2, 'Medium', 'Not Started', ''],
      [2, 'Coordinate with Barangay Culasi officials', 'VP–Internal', 4, 'High', 'In Progress', 'Courtesy call set with the barangay captain.'],
      [2, 'Solicit donations from partner establishments', 'Treasurer', 10, 'High', 'Not Started', ''],
      [2, 'Prepare the master list of beneficiaries', 'Treasurer', 12, 'Medium', 'Not Started', ''],
      [2, 'Draft the documentation plan', 'Secretary', 14, 'Low', 'Not Started', '']
    ];

    rows.forEach(function (r) {
      var task = {
        id: U.uid('tsk'),
        eventId: evIds[r[0]],
        title: r[1],
        assigneeId: r[2] ? (byPos[r[2]] || '') : '',
        dueDate: d(r[3]),
        priority: r[4],
        status: r[5],
        remarks: r[6] || '',
        blockedReason: r[5] === 'On hold'
          ? 'Waiting for the Office of Student Affairs to endorse the invitation letter.' : '',
        completedAt: '',
        sample: true,
        createdAt: nowISO(),
        updatedAt: nowISO()
      };
      // Completed sample work is stamped a day before it was due, so the report
      // has believable "date completed" values.
      if (task.status === 'Done') {
        task.completedAt = new Date(U.parse(U.addDays(task.dueDate, -1)).getTime()).toISOString();
      }
      state.tasks.push(task);
    });

    /* ---- the provinces ----
       Enough real-looking work in a few colleges that the Republic roll-up on the
       Overview has something to say, and a national can open a college's activity
       and find it read-only. Marked as sample, so "Clear sample data" takes the
       whole lot out in one go. */
    function unitByCode(code) {
      for (var ui = 0; ui < state.units.length; ui++) {
        if (state.units[ui].code === code) return state.units[ui];
      }
      return null;
    }

    /* One Governor per college, and no more. The rehearsal only has to show
       that other units exist and are getting on with their own work; a second
       invented name per college shows nothing extra and is one more row to tell
       from a real officer when the dry run ends. */
    var lguRoster = [
      ['CN',   'Pauline Grace Alcantara', 'Governor', 'Executive'],
      ['COE',  'Rafael Guanzon',          'Governor', 'Executive'],
      ['CCS',  'Neil Patrick Oquendo',    'Governor', 'Executive'],
      ['CTE',  'Joyce Ann Palmares',      'Governor', 'Executive'],
      ['CBA',  'Dexter Lim',              'Governor', 'Executive']
    ];
    var lguPeople = {};
    lguRoster.forEach(function (r) {
      var u = unitByCode(r[0]);
      if (!u) return;
      var p = {
        id: U.uid('per'), name: r[1], position: r[2], committee: r[3],
        email: '', unitId: u.id, access: 'officer', eventIds: [], claimed: false,
        active: true, sample: true, createdAt: nowISO(), updatedAt: nowISO()
      };
      state.people.push(p);
      lguPeople[r[0] + ':' + r[2]] = p.id;
    });

    // [code, title, description, startOffset, endOffset, venue, head position, status]
    var lguEvents = [
      ['CN',  'Nurses Week 2026', 'Capping and pinning ceremony, skills competition, and a community blood-letting drive.',
        12, 15, 'CN Amphitheatre', 'Governor', 'Upcoming'],
      ['CN',  'Community Blood-Letting Drive', 'Partnership with the Philippine Red Cross Capiz Chapter.',
        -6, 0, 'Barangay Baybay Covered Court', 'Secretary', 'Completed'],
      ['COE', 'Engineering Week 2026', 'Bridge-building contest, technical quiz bowl, and the general assembly.',
        20, 24, 'COE Building and Quadrangle', 'Governor', 'Upcoming'],
      ['CCS', 'Hour of Code — Roxas City', 'Outreach coding workshop for two public high schools.',
        6, 0, 'CCS Computer Laboratory 2', 'Governor', 'Ongoing'],
      ['CTE', 'Teachers Day Tribute', 'Programme and tribute for the college faculty.',
        3, 0, 'CTE Function Room', 'Governor', 'Ongoing'],
      ['CBA', 'Business Month Kick-off', 'Opening programme and the inter-year sales challenge.',
        30, 33, 'CBA Audio-Visual Room', 'Governor', 'Upcoming']
    ];

    var lguEventIds = {};
    lguEvents.forEach(function (r) {
      var u = unitByCode(r[0]);
      if (!u) return;
      var ev = {
        id: U.uid('evt'), unitId: u.id, title: r[1], description: r[2],
        dateStart: d(r[3]), dateEnd: r[4] ? d(r[4]) : '', venue: r[5],
        headId: lguPeople[r[0] + ':' + r[6]] || '',
        status: r[7], sample: true, createdAt: nowISO(), updatedAt: nowISO()
      };
      state.events.push(ev);
      lguEventIds[r[1]] = ev.id;
    });

    // [event title, task, code:position of assignee, dueOffset, priority, status]
    var lguTasks = [
      ['Nurses Week 2026', 'Draft and route the activity proposal', 'CN:Governor', -3, 'High', 'Done'],
      ['Nurses Week 2026', 'Reserve the amphitheatre', 'CN:Governor', -1, 'High', 'In Progress'],
      ['Nurses Week 2026', 'Order caps and pins for 84 graduates', 'CN:Governor', 5, 'High', 'Not Started'],
      ['Nurses Week 2026', 'Invite the clinical instructors', 'CN:Governor', 7, 'Medium', 'Not Started'],
      ['Nurses Week 2026', 'Prepare the skills competition mechanics', '', 9, 'Medium', 'Not Started'],

      ['Community Blood-Letting Drive', 'Coordinate with the Red Cross chapter', 'CN:Governor', -12, 'High', 'Done'],
      ['Community Blood-Letting Drive', 'Secure the barangay permit', 'CN:Governor', -10, 'High', 'Done'],
      ['Community Blood-Letting Drive', 'Prepare the donor master list', 'CN:Governor', -7, 'Medium', 'Done'],

      ['Engineering Week 2026', 'Draft the activity proposal', 'COE:Governor', -2, 'High', 'For Review'],
      ['Engineering Week 2026', 'Canvass materials for the bridge contest', 'COE:Governor', 4, 'Medium', 'In Progress'],
      ['Engineering Week 2026', 'Book the quadrangle and sound system', 'COE:Governor', 8, 'Medium', 'Not Started'],
      ['Engineering Week 2026', 'Prepare the quiz bowl questions', '', 12, 'Low', 'Not Started'],

      ['Hour of Code — Roxas City', 'Letter to the two partner high schools', 'CCS:Governor', -4, 'High', 'Done'],
      ['Hour of Code — Roxas City', 'Reserve Computer Laboratory 2', 'CCS:Governor', -2, 'Medium', 'Done'],
      ['Hour of Code — Roxas City', 'Prepare the workshop handouts', 'CCS:Governor', 1, 'High', 'In Progress'],
      ['Hour of Code — Roxas City', 'Arrange snacks for 60 participants', 'CCS:Governor', 2, 'Medium', 'On hold'],

      ['Teachers Day Tribute', 'Programme and script', 'CTE:Governor', -1, 'High', 'In Progress'],
      ['Teachers Day Tribute', 'Tokens for the faculty', 'CTE:Governor', 2, 'Medium', 'Not Started'],

      ['Business Month Kick-off', 'Draft the activity proposal', 'CBA:Governor', 10, 'High', 'Not Started'],
      ['Business Month Kick-off', 'Sales challenge mechanics', 'CBA:Governor', 16, 'Medium', 'Not Started']
    ];

    lguTasks.forEach(function (r) {
      var evId = lguEventIds[r[0]];
      if (!evId) return;
      var t = {
        id: U.uid('tsk'), kind: 'event', eventId: evId, title: r[1],
        assigneeId: r[2] ? (lguPeople[r[2]] || '') : '',
        dueDate: d(r[3]), priority: r[4], status: r[5], remarks: '',
        blockedReason: r[5] === 'On hold'
          ? 'Waiting on the canteen to confirm the package price.' : '',
        completedAt: '', sample: true, createdAt: nowISO(), updatedAt: nowISO()
      };
      if (t.status === 'Done') {
        t.completedAt = new Date(U.parse(U.addDays(t.dueDate, -1)).getTime()).toISOString();
      }
      state.tasks.push(t);
    });

    /* A couple of letters in flight, including one that has been sent back, so
       the trail shows both passes without anyone having to stage it. */
    function officeByCode(code) {
      for (var oi = 0; oi < state.offices.length; oi++) {
        if (state.offices[oi].code === code) return state.offices[oi];
      }
      return null;
    }
    function stopFor(code) {
      var o = officeByCode(code);
      return o ? { id: U.uid('stp'), officeId: o.id, forwardedBy: '', receivedBy: '',
                   receivedAt: '', releasedAt: '', outcome: '', note: '' } : null;
    }
    function seedLetter(unitCode, subject, evTitle, inCharge, route, deadlineOffset) {
      var u = unitByCode(unitCode);
      if (!u) return null;
      var stops = route.map(stopFor).filter(Boolean);
      if (!stops.length) return null;
      var l = {
        id: U.uid('ltr'), unitId: u.id, eventId: lguEventIds[evTitle] || '',
        subject: subject, inChargeId: '', inChargeName: inCharge,
        deadline: deadlineOffset === null ? '' : d(deadlineOffset),
        status: 'Routing', stops: stops, sample: true,
        createdAt: nowISO(), updatedAt: nowISO()
      };
      state.letters.push(l);
      return l;
    }

    var l1 = seedLetter('CN', 'Activity proposal — Nurses Week 2026', 'Nurses Week 2026',
      'Pauline Grace Alcantara', ['ADV', 'DEAN', 'OSA', 'VPAA', 'OP'], 8);
    if (l1) {
      l1.stops[0].receivedBy = 'Ms. Delos Reyes';
      l1.stops[0].forwardedBy = 'Pauline Grace Alcantara';
      l1.stops[0].receivedAt = d(-11);
      l1.stops[0].releasedAt = d(-10);
      l1.stops[0].outcome = 'Approved';
      // Sitting at the Dean's office well past its usual turnaround.
      l1.stops[1].receivedBy = 'Mrs. Ferrer';
      l1.stops[1].forwardedBy = 'Pauline Grace Alcantara';
      l1.stops[1].receivedAt = d(-9);
    }

    var l2 = seedLetter('COE', 'Request to use the quadrangle', 'Engineering Week 2026',
      'Rafael Guanzon', ['OSA', 'PPO'], 5);
    if (l2) {
      // Sent back, and the second run at the same desk sits under it.
      l2.stops[0].receivedBy = 'Sir Alvarez';
      l2.stops[0].forwardedBy = 'Rafael Guanzon';
      l2.stops[0].receivedAt = d(-6);
      l2.stops[0].releasedAt = d(-4);
      l2.stops[0].outcome = 'Returned for revision';
      l2.stops[0].note = 'Attach the equipment list and the clean-up plan.';
      var again = stopFor('OSA');
      if (again) l2.stops.splice(1, 0, again);
    }

    seedLetter('CCS', 'Excuse letter for the Hour of Code facilitators',
      'Hour of Code — Roxas City', 'Neil Patrick Oquendo', ['OSA', 'DEAN'], 2);

    /* Every letter above belongs to a college, and the person rehearsing this is
       usually a national executive — who would open the Letters tab and find it
       empty, which teaches them the tracker does not work rather than how it
       does. So the National government carries its own, on the council's real
       routes, including one that has to be chased. */
    var n1 = seedLetter('NAT', 'Request for the General Assembly budget', 'General Assembly 2026',
      'Althea Ramirez', ['AUTH', 'GOV', 'PRES', 'ADV', 'DEAN', 'OSA', 'BUD', 'VPAA', 'VPF', 'OP'], 12);
    if (n1) {
      ['Althea Ramirez', 'Arron D. Aperocho', 'Arron D. Aperocho'].forEach(function (who, i) {
        n1.stops[i].receivedBy = who;
        n1.stops[i].forwardedBy = 'Althea Ramirez';
        n1.stops[i].receivedAt = d(-9 + i);
        n1.stops[i].releasedAt = d(-8 + i);
        n1.stops[i].outcome = 'Approved';
      });
      // Sitting with the adviser longer than that desk usually takes.
      n1.stops[3].receivedBy = 'Sir Gonzales';
      n1.stops[3].forwardedBy = 'Althea Ramirez';
      n1.stops[3].receivedAt = d(-7);
    }

    var n2 = seedLetter('NAT', 'Permission to attend the regional student leaders\u2019 congress',
      '', 'Miguel Fortaleza',
      ['AUTH', 'GOV', 'PRES', 'ADV', 'DEAN', 'OSA', 'BUD', 'VPAA', 'VPF', 'OP'], 4);
    if (n2) {
      n2.stops[0].receivedBy = 'Miguel Fortaleza';
      n2.stops[0].forwardedBy = 'Miguel Fortaleza';
      n2.stops[0].receivedAt = d(-3);
      n2.stops[0].releasedAt = d(-3);
      n2.stops[0].outcome = 'Approved';
      // Sent back by the President — the extra progress entry the trail shows.
      n2.stops[1].receivedBy = 'Arron D. Aperocho';
      n2.stops[1].forwardedBy = 'Miguel Fortaleza';
      n2.stops[1].receivedAt = d(-2);
      n2.stops[1].releasedAt = d(-1);
      n2.stops[1].outcome = 'Returned for revision';
      n2.stops[1].note = 'Attach the invitation letter before this goes any further.';
      var retry = stopFor('GOV');
      if (retry) n2.stops.splice(2, 0, retry);
    }

    // One kept inside the council, so the President-signs-everything rule and
    // its one exception are both visible in the rehearsal.
    var n3 = seedLetter('NAT', 'Minutes of the 3rd Executive Board meeting', '',
      'Althea Ramirez', ['AUTH', 'GOV'], null);
    if (n3) n3.internal = true;

    state.seeded = true;
  }

  global.Store = {
    STATUSES: STATUSES, PRIORITIES: PRIORITIES, EVENT_STATUSES: EVENT_STATUSES,
    UNIT_KINDS: UNIT_KINDS,
    units: units, unit: unit, unitName: unitName, unitKindLabel: unitKindLabel,
    isIndependent: isIndependent, trackerTitle: trackerTitle, trackerName: trackerName,
    nationalUnit: nationalUnit, nationalUnitId: nationalUnitId, unitStats: unitStats,
    addUnit: addUnit, updateUnit: updateUnit, setUnitActive: setUnitActive,
    deleteUnit: deleteUnit, unitEventCount: unitEventCount,
    load: load, save: save, subscribe: subscribe,
    raw: function () { return state; },
    positions: function () { return state.positions.slice(); },
    committees: function () { return state.committees.slice(); },
    addListValue: addListValue, removeListValue: removeListValue,
    LETTER_STATUSES: LETTER_STATUSES, STOP_OUTCOMES: STOP_OUTCOMES,
    offices: offices, office: office, officeName: officeName, officeOwner: officeOwner,
    addOffice: addOffice, updateOffice: updateOffice, setOfficeActive: setOfficeActive,
    deleteOffice: deleteOffice, officeLetterCount: officeLetterCount,
    routeTemplates: routeTemplates,
    letters: letters, letter: letter, addLetter: addLetter, updateLetter: updateLetter,
    deleteLetter: deleteLetter, letterInCharge: letterInCharge,
    currentStop: currentStop, stopState: stopState, daysAtCurrent: daysAtCurrent,
    wasReturned: wasReturned, isRepeatOf: isRepeatOf,
    isStuck: isStuck, isLetterOverdue: isLetterOverdue, letterNeedsAttention: letterNeedsAttention,
    letterWhere: letterWhere, letterProgress: letterProgress, letterStats: letterStats,
    receiveStop: receiveStop, releaseStop: releaseStop,
    passStop: passStop, undoLastStep: undoLastStep, lastStep: lastStep, reopenStop: reopenStop,
    applyRemote: applyRemote, applyRemoteDeletion: applyRemoteDeletion,
    applyRemoteTerm: applyRemoteTerm,
    council: council, applyRemoteCouncil: applyRemoteCouncil,
    outbound: outbound, deletions: deletions, isDeleted: isDeleted,
    syncState: syncState, markSynced: markSynced, remapIds: remapIds,
    storageBroken: storageBroken,
    now: nowISO,
    resetSyncMarks: resetSyncMarks,
    commit: commit,
    insertStop: insertStop, presidentOfficeId: presidentOfficeId,
    stopName: stopName, stopTurnaround: stopTurnaround, sameDesk: sameDesk,
    officeByCode: officeByCode,
    setLetterStatus: setLetterStatus, byLetterUrgency: byLetterUrgency,
    org: org, updateOrg: updateOrg,
    templateFor: templateFor, setUnitTemplate: setUnitTemplate,
    term: term, termStatus: termStatus, declareTerm: declareTerm, withdrawTerm: withdrawTerm,
    compliance: compliance, unitCompliance: unitCompliance,
    overrideCompliance: overrideCompliance, setOverallLink: setOverallLink, closeTerm: closeTerm, closePreview: closePreview,
    report: report, reports: reports, saveReport: saveReport, deleteReport: deleteReport,
    people: people, person: person, personName: personName, personByEmail: personByEmail,
    assignable: assignable,
    volunteersFor: volunteersFor, removeVolunteerFrom: removeVolunteerFrom,
    addPerson: addPerson, addPeople: addPeople, updatePerson: updatePerson, setPersonActive: setPersonActive,
    deletePerson: deletePerson, personHolds: personHolds, unitHeads: unitHeads,
    reconcileDirectory: reconcileDirectory,
    duplicatePeopleCount: duplicatePeopleCount, mergeDuplicatePeople: mergeDuplicatePeople,
    events: events, event: event, addEvent: addEvent, updateEvent: updateEvent, deleteEvent: deleteEvent,
    cancelEvent: cancelEvent, reinstateEvent: reinstateEvent,
    makeVolunteerCode: makeVolunteerCode, clearVolunteerCode: clearVolunteerCode,
    eventByVolunteerCode: eventByVolunteerCode,
    isShelved: isShelved, isCancelled: isCancelled, isDirectiveSet: isDirectiveSet,
    directiveSets: directiveSets, directiveWork: directiveWork,
    needsFeedback: needsFeedback, setFeedbackLink: setFeedbackLink,
    waiveFeedback: waiveFeedback, restoreFeedback: restoreFeedback,
    tasks: tasks, task: task, addTask: addTask, updateTask: updateTask,
    setTaskStatus: setTaskStatus, deleteTask: deleteTask,
    isOverdue: isOverdue, isPending: isPending, isDueToday: isDueToday, isDueThisWeek: isDueThisWeek,
    stats: stats, eventStats: eventStats,
    byDueDate: byDueDate, byPriority: byPriority, byStatus: byStatus, byUrgency: byUrgency,
    lastPerson: lastPerson, setLastPerson: setLastPerson,
    toJSON: toJSON, fromJSON: fromJSON,
    resetAll: resetAll,
    clearLocalCopy: clearLocalCopy, _seedRehearsal: _seedRehearsal,

    // The workspace update: bulletin, templates, duplicating, academic years, history.
    BULLETIN_PRIORITIES: BULLETIN_PRIORITIES, AUDIENCE_KINDS: AUDIENCE_KINDS,
    announcements: announcements, announcement: announcement,
    announcementState: announcementState, announcementFor: announcementFor,
    addAnnouncement: addAnnouncement, updateAnnouncement: updateAnnouncement,
    deleteAnnouncement: deleteAnnouncement,
    acks: acks, hasAcked: hasAcked, acknowledge: acknowledge,
    announcementRoll: announcementRoll, ackStatus: ackStatus,
    templates: templates, template: template, addTemplate: addTemplate,
    updateTemplate: updateTemplate, deleteTemplate: deleteTemplate,
    templateFromEvent: templateFromEvent,
    createEventWithTasks: createEventWithTasks, duplicateEvent: duplicateEvent,
    years: years, currentYear: currentYear, yearInfo: yearInfo, archivedYears: archivedYears,
    yearOf: yearOf, yearOfDate: yearOfDate, yearLocked: yearLocked, isLocked: isLocked,
    anchorOf: anchorOf, yearCounts: yearCounts, yearStartMonth: function () { return state.yearStartMonth; },
    archiveYear: archiveYear, unlockYear: unlockYear, lockYear: lockYear, restoreYear: restoreYear,
    setYearStartMonth: setYearStartMonth,
    historyFor: historyFor
  };
})(window);
