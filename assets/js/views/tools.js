/* Tools — utilities for FCUSR operations, in one place.

   Three kinds of thing can live here and the page is built so a fourth needs
   no redesign: add an entry to TOOLS and, for a separate app, a page to PAGES.

     built in   runs inside the tracker (the Watermark Studio)
     separate   an application of its own, installed from the council's Drive

   A separate app is never presented as part of the tracker. Its card says it is
   a download, its page says how to install it, and its button leaves the app. */
(function (global) {
  'use strict';

  /* ---------- EDIT HERE ----------
     The words on the two app pages. They describe what each application is
     for; keep them in step with the apps themselves when either changes. */
  var PAGES = {
    'event-management': {
      name: 'FCUSR Event Management System',
      short: 'Event Management System',
      icon: 'layers',
      tone: 'gold',
      download: 'https://drive.google.com/drive/folders/1jU1wYA7tesa_r7iS_Z2T33jEmBnIz4cc?usp=drive_link',
      downloadLabel: 'Download / Install Event Management System',
      tagline: 'A dedicated system for running the larger events of the Republic.',
      what: 'A separate application built for event operations. Where the Task Tracker keeps the ' +
        'council’s work and deadlines, the Event Management System is set up around a single ' +
        'large event and the people running it.',
      problem: 'A big event has more moving parts than a task list can hold at once. Giving it its own ' +
        'system keeps the day itself organised, while the Task Tracker keeps doing what it does best: ' +
        'who is responsible for what, and by when.',
      when: [
        'The event is large: many participants, several committees, or more than one venue.',
        'It runs over more than one day, or has a full program to keep to.',
        'You need the event handled from one place on the day, not only planned beforehand.'
      ],
      notWhen: 'For planning, assignments and deadlines, stay in the Task Tracker. Most activities ' +
        'never need anything more.',
      features: [
        ['users', 'Participants', 'Keep the people taking part in the event organised in one place.'],
        ['calendar', 'Program and schedule', 'Follow the event’s flow as it is meant to run.'],
        ['layers', 'Committees and teams', 'See which group handles which part of the event.'],
        ['check', 'On the day', 'Run the event from one screen instead of scattered notes.']
      ],
      steps: [
        ['Plan it here first', 'Create the event in the Task Tracker and assign the preparation tasks.'],
        ['Set up the system', 'Install the Event Management System and set the event up in it.'],
        ['Run the event', 'Use it on the day to keep the operation together.'],
        ['Close it out', 'File the accomplishment report in the Task Tracker, as for any activity.']
      ],
      install: [
        'Press the download button. It opens the official FCUSR folder in Google Drive.',
        'Download the installation file for your device from that folder.',
        'Follow the instructions included in the folder to install it.',
        'Ask FCUSR Nationals if you are unsure which file is the current version.'
      ]
    },
    'score-tracker': {
      name: 'FCUSR Score Tracker',
      short: 'Score Tracker',
      icon: 'trophy',
      tone: 'ink',
      download: 'https://drive.google.com/drive/folders/1msXXEtfC7oVMCJB_2yIbqjP0ur_BS4P9?usp=drive_link',
      downloadLabel: 'Download Score Tracker',
      tagline: 'Competition scores and rankings, kept efficiently and fairly.',
      what: 'A separate application for competitions. It holds the scores and works out who is ' +
        'ahead, so the tabulators are not adding columns by hand while an audience waits.',
      problem: 'Scoring on paper or in a hastily built spreadsheet is slow, easy to get wrong, and hard ' +
        'to defend when a result is questioned. A dedicated tracker keeps every score in one place and ' +
        'the ranking consistent.',
      supports: ['Quiz bowls', 'Pageants', 'Sports fests', 'Debates', 'Singing and dance contests',
                 'Any contest with judges'],
      steps: [
        ['Set up the competition', 'Enter the contestants and how they will be scored.'],
        ['Record the scores', 'Enter scores as each round or performance is judged.'],
        ['See the ranking', 'The standings follow from the scores entered.'],
        ['Announce the results', 'Read the final ranking out with confidence.']
      ],
      tips: [
        'Agree the scoring criteria with the judges before the competition starts.',
        'Have one person enter the scores, and a second check them.',
        'Keep a copy of the final results with the activity’s documentation.'
      ],
      install: [
        'Press the download button. It opens the official FCUSR folder in Google Drive.',
        'Download the Score Tracker file for your device.',
        'Follow the instructions included in the folder to install it.',
        'Try it once before competition day, so nobody is learning it in front of the judges.'
      ]
    }
  };

  // The cards on the Tools page. A new tool is one more entry here.
  var TOOLS = [
    {
      id: 'watermark', kind: 'built', icon: 'stamp', name: 'Watermark Studio',
      line: 'Add your official watermark to many documentation photos at once.',
      points: ['A whole batch in one go', 'Saved logos and presets', 'Photos never leave your device'],
      open: '#/tools/watermark', openLabel: 'Open Watermark Studio'
    },
    {
      id: 'event-management', kind: 'separate', icon: 'layers', name: 'FCUSR Event Management System',
      line: 'A dedicated system for managing larger event operations.',
      points: ['For large and multi-day events', 'Separate app to install', 'Works alongside the tracker']
    },
    {
      id: 'score-tracker', kind: 'separate', icon: 'trophy', name: 'FCUSR Score Tracker',
      line: 'Manage competition scores and rankings efficiently.',
      points: ['For quiz bowls, pageants and contests', 'Rankings from the scores', 'Separate app to install']
    }
  ];

  function online() { return !(global.navigator && navigator.onLine === false); }

  /* ---------- the Tools page ---------- */

  function hub() {
    var html = '<div class="page-head"><div><h1>Tools</h1>' +
      '<div class="sub">Useful systems and utilities for FCUSR operations.</div></div></div>';
    html += Workspace.hint('tools', 'The <strong>Watermark Studio</strong> runs right here in the ' +
      'tracker. The other two are separate apps you download and install from the council’s Drive.');
    html += '<div class="tool-grid">' + TOOLS.map(card).join('') + '</div>';
    html += '<p class="small muted" style="margin:18px 2px 0">More tools will appear here as the council ' +
      'adds them.</p>';
    return html;
  }

  function card(t) {
    var page = PAGES[t.id];
    var built = t.kind === 'built';
    return '<article class="tool-card tool-' + t.id + '">' +
      '<div class="tc-band">' +
        '<span class="tc-icon">' + UI.icon(t.icon) + '</span>' +
        '<span class="tc-kind">' + (built ? 'Built in' : 'Separate app · Download') + '</span>' +
      '</div>' +
      '<div class="tc-body">' +
        '<h2>' + U.esc(t.name) + '</h2>' +
        '<p class="tc-line">' + U.esc(t.line) + '</p>' +
        '<ul class="tc-points">' + t.points.map(function (p) {
          return '<li>' + UI.icon('check') + U.esc(p) + '</li>';
        }).join('') + '</ul>' +
      '</div>' +
      '<div class="tc-actions">' +
        (built
          ? '<a class="btn btn-primary" href="' + t.open + '">' + UI.icon(t.icon) + U.esc(t.openLabel) + '</a>'
          : '<a class="btn" href="#/tools/' + t.id + '">Learn more</a>' +
            Workspace.extLink(page.download, 'Download', 'btn btn-primary')) +
      '</div></article>';
  }

  /* ---------- a separate app's page ---------- */

  function header(p) {
    return '<a class="breadcrumb" href="#/tools">' + UI.icon('back') + 'All tools</a>' +
      '<section class="app-hero tone-' + p.tone + '">' +
        '<span class="ah-icon">' + UI.icon(p.icon) + '</span>' +
        '<div class="ah-text">' +
          '<span class="ah-kind">Separate application · installed from Google Drive</span>' +
          '<h1>' + U.esc(p.name) + '</h1>' +
          '<p>' + U.esc(p.tagline) + '</p>' +
          '<div class="ah-actions">' + downloadButton(p, true) + '</div>' +
        '</div>' +
      '</section>';
  }

  function downloadButton(p, glass) {
    return '<a class="btn ' + (glass ? 'btn-glass' : 'btn-primary') + ' dl-btn" href="' + U.esc(p.download) +
      '" target="_blank" rel="noopener noreferrer" data-download>' + UI.icon('download') +
      U.esc(p.downloadLabel) + '</a>';
  }

  function offlineNote() {
    return '<p class="small dl-offline" hidden>' + UI.icon('alert') +
      ' Internet connection required to download external software.</p>';
  }

  function section(title, inner) {
    return '<section class="section app-sec"><div class="section-head"><h2>' + U.esc(title) + '</h2></div>' +
      inner + '</section>';
  }

  function emsPage(p) {
    var html = header(p);
    html += '<div class="app-cols">' +
      section('What it is', '<div class="card"><p style="margin:0">' + U.esc(p.what) + '</p></div>') +
      section('The problem it solves', '<div class="card"><p style="margin:0">' + U.esc(p.problem) + '</p></div>') +
      '</div>';
    html += section('When to use it',
      '<div class="card"><ul class="plain-list">' + p.when.map(function (w) {
        return '<li>' + UI.icon('check') + '<span>' + U.esc(w) + '</span></li>';
      }).join('') + '</ul><p class="small muted" style="margin:10px 0 0">' + U.esc(p.notWhen) + '</p></div>');
    html += section('Main features', '<div class="feature-grid">' + p.features.map(function (f) {
      return '<div class="feature">' + '<span class="f-icon">' + UI.icon(f[0]) + '</span>' +
        '<strong>' + U.esc(f[1]) + '</strong><span>' + U.esc(f[2]) + '</span></div>';
    }).join('') + '</div>');
    html += section('How it works', '<ol class="flow">' + p.steps.map(function (s, i) {
      return '<li><span class="flow-n">' + (i + 1) + '</span><strong>' + U.esc(s[0]) + '</strong>' +
        '<span>' + U.esc(s[1]) + '</span></li>';
    }).join('') + '</ol>');
    html += install(p);
    return html;
  }

  /* Deliberately not the same page with a different name: the Score Tracker
     is about one number per contestant and who is ahead, so it leads with the
     kinds of contest it is for and a picture of a ranking. */
  function scorePage(p) {
    var html = header(p);
    html += '<div class="score-intro">' +
      '<div class="card">' +
        '<h2 style="margin-bottom:8px">What Score Tracker is</h2>' +
        '<p>' + U.esc(p.what) + '</p>' +
        '<p class="small muted" style="margin:0">' + U.esc(p.problem) + '</p>' +
      '</div>' +
      '<div class="podium" aria-hidden="true">' +
        podiumRow(1, 'Contestant A', 96.4) + podiumRow(2, 'Contestant B', 93.1) + podiumRow(3, 'Contestant C', 90.8) +
        '<span class="podium-note">An example of a ranking</span>' +
      '</div>' +
    '</div>';
    html += section('Competitions it suits', '<div class="chip-row">' + p.supports.map(function (s) {
      return '<span class="chip chip-plain">' + UI.icon('trophy') + U.esc(s) + '</span>';
    }).join('') + '</div>');
    html += section('From scores to ranking', '<ol class="flow flow-score">' + p.steps.map(function (s, i) {
      return '<li><span class="flow-n">' + (i + 1) + '</span><strong>' + U.esc(s[0]) + '</strong>' +
        '<span>' + U.esc(s[1]) + '</span></li>';
    }).join('') + '</ol>');
    html += section('How officers use it well', '<div class="card"><ul class="plain-list">' +
      p.tips.map(function (t) {
        return '<li>' + UI.icon('star') + '<span>' + U.esc(t) + '</span></li>';
      }).join('') + '</ul></div>');
    html += install(p);
    return html;
  }

  function podiumRow(rank, name, score) {
    return '<div class="podium-row r' + rank + '"><span class="pr-rank">' + rank + '</span>' +
      '<span class="pr-name">' + U.esc(name) + '</span><span class="pr-score">' + score.toFixed(1) + '</span></div>';
  }

  function install(p) {
    return section('Getting started and download',
      '<div class="card install">' +
        '<ol class="install-steps">' + p.install.map(function (s) { return '<li>' + U.esc(s) + '</li>'; }).join('') +
        '</ol>' +
        '<div class="row" style="margin-top:14px">' + downloadButton(p) +
        '<span class="small muted">Opens the official FCUSR folder in Google Drive, in a new tab.</span></div>' +
        offlineNote() +
      '</div>');
  }

  /* ---------- the Watermark Studio, fetched when opened ---------- */

  function studioShell() {
    return '<a class="breadcrumb" href="#/tools">' + UI.icon('back') + 'All tools</a>' +
      '<div id="wm-root" class="wm-loading"><div class="empty"><strong>Opening Watermark Studio…</strong>' +
      '<p>Just a moment.</p></div></div>';
  }

  function mountStudio(root) {
    var host = root.querySelector('#wm-root');
    Workspace.load('assets/js/watermark.js', function () { return !!global.WatermarkStudio; })
      .then(function () {
        if (!document.body.contains(host)) return;
        host.classList.remove('wm-loading');
        WatermarkStudio.mount(host);
      })
      .catch(function (err) {
        if (!document.body.contains(host)) return;
        host.innerHTML = UI.empty('Watermark Studio could not open', err.message,
          '<button type="button" class="btn btn-primary" data-retry>Try again</button>', 'calm');
        host.querySelector('[data-retry]').addEventListener('click', function () { App.render(); });
      });
  }

  /* ---------- the view ---------- */

  function render(params) {
    var id = params && params.id;
    if (id === 'watermark') return studioShell();
    if (id === 'event-management') return emsPage(PAGES[id]);
    if (id === 'score-tracker') return scorePage(PAGES[id]);
    if (id) {
      return '<a class="breadcrumb" href="#/tools">' + UI.icon('back') + 'All tools</a>' +
        UI.empty('That tool is not here', 'It may have been renamed or removed.',
          '<a class="btn btn-primary" href="#/tools">See all tools</a>');
    }
    return hub();
  }

  function mount(root, params) {
    var id = params && params.id;
    if (id === 'watermark') return mountStudio(root);
    // Leaving for Drive needs a connection; say so rather than open a dead tab.
    var note = root.querySelector('.dl-offline');
    U.els('[data-download]', root).forEach(function (a) {
      a.addEventListener('click', function (ev) {
        if (online()) return;
        ev.preventDefault();
        if (note) note.hidden = false;
        UI.toast('Internet connection required to download external software.', 'error');
      });
    });
  }

  global.ViewTools = {
    render: render, mount: mount, PAGES: PAGES, TOOLS: TOOLS,
    // The studio keeps its own photos on screen; a sync arriving must not redraw it away.
    keepAlive: function (params) { return !!(params && params.id === 'watermark'); }
  };
})(window);
