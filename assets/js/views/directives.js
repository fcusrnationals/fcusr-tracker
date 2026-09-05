/* Directives — council business that belongs to no activity.

   Standing instructions, errands, things the President asks for on a Tuesday.
   They need no accomplishment report and never appear in an event's PDF, which
   is the whole point of keeping them apart from event work. */
(function (global) {
  'use strict';

  var filter = 'open';
  var draft = null;
  var addOpen = false;
  var focusNext = false;

  var FILTERS = {
    open: { label: 'Open', test: Store.isPending },
    done: { label: 'Done', test: function (t) { return t.status === 'Done'; } }
  };

  function blankDraft() {
    return { title: '', assigneeId: '', dueDate: U.today(), priority: 'Medium' };
  }

  function render() {
    if (!draft) draft = blankDraft();
    var all = Store.tasks({ kind: 'directive' });
    var s = Store.stats(all);
    var list = all.filter(FILTERS[filter].test).sort(Store.byDueDate);

    var html =
      '<div class="page-head"><div><h1>Directives</h1>' +
      '<div class="sub">Standing instructions that sit outside any event.</div></div>' +
      (addOpen ? '' : '<button type="button" class="btn btn-primary" data-open-add>' +
        UI.icon('plus') + 'New directive</button>') +
      '</div>';

    if (all.length) {
      html += '<div class="segmented" role="group" aria-label="Filter directives" style="margin-bottom:14px">' +
        Object.keys(FILTERS).map(function (k) {
          var n = all.filter(FILTERS[k].test).length;
          return '<button type="button" data-filter="' + k + '"' +
            (filter === k ? ' class="is-active" aria-pressed="true"' : ' aria-pressed="false"') + '>' +
            U.esc(FILTERS[k].label) + ' ' + n + '</button>';
        }).join('') + '</div>';
    }

    if (addOpen) html += addForm();

    if (!all.length) {
      return html + UI.empty('No directives yet',
        'Use these for council business that is not tied to an activity — an errand, ' +
        'a standing instruction, a follow-up.',
        addOpen ? '' : '<button type="button" class="btn btn-primary" data-open-add>' +
          UI.icon('plus') + 'New directive</button>', 'tasks');
    }
    if (!list.length) {
      return html + UI.empty('Nothing here',
        filter === 'open' ? 'Every directive is done.' : 'Nothing finished yet.', '', 'calm');
    }

    html += '<div class="list">' + list.map(function (t) {
      return UI.taskRow(t, [Store.personName(t.assigneeId)], { who: true, lean: true });
    }).join('') + '</div>';

    if (s.overdue) {
      html += '<p class="small muted" style="margin-top:10px">' +
        U.plural(s.overdue, 'directive') + ' past the date set for it.</p>';
    }
    return html;
  }

  function addForm() {
    return '<div class="card" style="border-color:var(--gold-300);background:var(--gold-50);margin-bottom:14px">' +
      '<div class="field"><label for="d-title">Directive <span class="req">*</span></label>' +
      '<input type="text" id="d-title" maxlength="160" value="' + U.esc(draft.title) + '" ' +
      'placeholder="e.g. Follow up the adviser on the budget memo">' +
      '<div class="error-text" hidden>Say what needs doing.</div></div>' +
      '<div class="field-row">' +
        '<div class="field"><label for="d-who">Assigned to</label>' +
        '<select id="d-who">' + UI.peopleOptions(draft.assigneeId, true) + '</select></div>' +
        '<div class="field"><label for="d-due">Due date</label>' +
        '<input type="date" id="d-due" value="' + U.esc(draft.dueDate) + '"></div>' +
      '</div>' +
      '<div class="row">' +
        '<button type="button" class="btn btn-primary" data-save>' + UI.icon('plus') + 'Add directive</button>' +
        '<button type="button" class="btn btn-ghost" data-close-add>Done adding</button>' +
      '</div></div>';
  }

  function mount(root) {
    U.els('[data-open-add]', root).forEach(function (b) {
      b.addEventListener('click', function () { addOpen = true; focusNext = true; App.render(); });
    });
    var closeAdd = root.querySelector('[data-close-add]');
    if (closeAdd) closeAdd.addEventListener('click', function () {
      addOpen = false; draft = null; App.render();
    });

    U.els('[data-filter]', root).forEach(function (b) {
      b.addEventListener('click', function () { filter = b.getAttribute('data-filter'); App.render(); });
    });
    U.els('[data-edit]', root).forEach(function (b) {
      b.addEventListener('click', function () { Forms.taskForm(b.getAttribute('data-edit')); });
    });

    var title = root.querySelector('#d-title');
    if (!title) return;
    var who = root.querySelector('#d-who');
    var due = root.querySelector('#d-due');

    function sync() {
      draft = { title: title.value, assigneeId: who.value, dueDate: due.value, priority: 'Medium' };
    }
    [title, who, due].forEach(function (n) {
      n.addEventListener('input', sync);
      n.addEventListener('change', sync);
    });

    function submit() {
      var v = title.value.trim();
      if (!v) {
        var f = title.closest('.field');
        f.classList.add('has-error');
        f.querySelector('.error-text').hidden = false;
        title.focus();
        return;
      }
      // Reset before saving: the store notifies and the screen redraws.
      draft = { title: '', assigneeId: who.value, dueDate: due.value, priority: 'Medium' };
      focusNext = true;
      Store.addTask({
        kind: 'directive', title: v, assigneeId: who.value,
        dueDate: due.value, priority: 'Medium'
      });
      UI.toast('Directive added.');
    }

    root.querySelector('[data-save]').addEventListener('click', submit);
    title.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') { e.preventDefault(); submit(); }
    });

    if (focusNext) { focusNext = false; title.focus(); }
  }

  global.ViewDirectives = { render: render, mount: mount };
})(window);
