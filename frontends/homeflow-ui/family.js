/* HomeFlow Family Pilot v1, vanilla JS SPA.
   Co-written and curated by Randall Gossett. */

(function () {
  'use strict';

  var API = '/api/family';
  var TEMPORAL_NOW = '/api/v1/temporal/now-public';

  var state = {
    user: null,
    household: null,
    members: [],
    isOwner: false,
    page: 'home',
    cache: {}
  };

  // ── Helpers ───────────────────────────────────────────────────────────
  function $(sel, root) { return (root || document).querySelector(sel); }
  function el(tag, attrs, children) {
    var node = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        if (k === 'class') node.className = attrs[k];
        else if (k === 'on' && typeof attrs[k] === 'object') {
          Object.keys(attrs[k]).forEach(function (ev) {
            node.addEventListener(ev, attrs[k][ev]);
          });
        } else if (k === 'html') node.innerHTML = attrs[k];
        else if (k === 'text') node.textContent = attrs[k];
        else if (attrs[k] !== null && attrs[k] !== undefined) node.setAttribute(k, attrs[k]);
      });
    }
    (children || []).forEach(function (c) {
      if (c == null) return;
      node.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
    });
    return node;
  }
  function clear(node) { while (node.firstChild) node.removeChild(node.firstChild); }
  function toast(msg) {
    var t = $('#hfToast');
    if (!t) {
      t = el('div', { id: 'hfToast', class: 'hf-toast' });
      document.body.appendChild(t);
    }
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(t._t);
    t._t = setTimeout(function () { t.classList.remove('show'); }, 2200);
  }

  function fmtTime(ts) {
    var d = new Date(ts);
    var diff = Date.now() - ts;
    if (diff < 60000) return 'just now';
    if (diff < 3600000) return Math.floor(diff / 60000) + 'm ago';
    if (diff < 86400000) return Math.floor(diff / 3600000) + 'h ago';
    return d.toLocaleDateString();
  }
  function todayIso() { return new Date().toISOString().slice(0, 10); }

  // ── API ───────────────────────────────────────────────────────────────
  function api(method, path, body) {
    var opts = { method: method, headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin' };
    if (body !== undefined) opts.body = JSON.stringify(body);
    return fetch(API + path, opts).then(function (r) {
      if (r.status === 401) {
        window.location.href = '/auth/google';
        throw new Error('not_authenticated');
      }
      return r.json().then(function (data) {
        if (!r.ok) {
          var msg = (data && data.error) || ('http_' + r.status);
          var err = new Error(msg);
          err.status = r.status;
          throw err;
        }
        return data;
      });
    });
  }

  // ── Bootstrap ─────────────────────────────────────────────────────────
  function bootstrap() {
    return api('GET', '/bootstrap').then(function (boot) {
      state.user = boot.user;
      state.household = boot.household;
      state.members = boot.members || [];
      state.isOwner = !!boot.isOwner;
      renderShell();
      if (!state.household) {
        renderWizard();
      } else {
        navigate(state.page || 'home');
      }
      startSeasonStrip();
    }).catch(function (err) {
      if (err.message !== 'not_authenticated') {
        renderLoginPrompt();
      }
    });
  }

  function renderLoginPrompt() {
    var root = $('#hfRoot');
    clear(root);
    root.appendChild(el('div', { class: 'hf-card' }, [
      el('h2', { text: 'Welcome to HomeFlow' }),
      el('p', { text: 'Sign in with Google to set up your household.' }),
      el('p', null, [el('a', { class: 'hf-btn', href: '/auth/google' }, ['Sign in with Google'])])
    ]));
  }

  // ── Shell + nav ───────────────────────────────────────────────────────
  function renderShell() {
    var root = $('#hfRoot');
    clear(root);

    var seasonStrip = el('div', { id: 'hfSeasonStrip', class: 'hf-season-strip' }, [
      el('span', { class: 'hf-season-label', text: 'Universal Times' }),
      el('span', { id: 'hfSeasonName', class: 'hf-season-meta', text: 'connecting...' }),
      el('div', { class: 'hf-season-bar' }, [el('div', { id: 'hfSeasonBar', class: 'hf-season-bar-fill' })])
    ]);

    var header = el('header', { class: 'hf-header' }, [
      el('div', { class: 'hf-brand' }, [
        el('span', { class: 'hf-brand-mark', text: '⌂' }),
        el('span', { text: 'HomeFlow' })
      ]),
      el('div', { class: 'hf-userbox' }, [
        el('span', { text: state.user ? state.user.displayName || state.user.email : '' }),
        el('button', { type: 'button', on: { click: signOut } }, ['Sign out'])
      ])
    ]);

    var nav = el('nav', { id: 'hfNav', class: 'hf-nav' });
    var pages = [
      { key: 'home', label: 'Home' },
      { key: 'chores', label: 'Chores' },
      { key: 'meal-plan', label: 'Meal Plan' },
      { key: 'recipes', label: 'Recipes' },
      { key: 'pantry', label: 'Pantry' },
      { key: 'shopping', label: 'Shopping' },
      { key: 'settings', label: 'Settings' }
    ];
    pages.forEach(function (p) {
      nav.appendChild(el('button', {
        type: 'button',
        'data-page': p.key,
        on: { click: function () { navigate(p.key); } }
      }, [p.label]));
    });

    var main = el('main', { id: 'hfMain', class: 'hf-main' });
    root.appendChild(el('div', { class: 'hf-app' }, [seasonStrip, header, nav, main]));
  }

  function navigate(page) {
    state.page = page;
    var nav = $('#hfNav');
    if (nav) {
      Array.prototype.forEach.call(nav.children, function (b) {
        b.classList.toggle('active', b.getAttribute('data-page') === page);
      });
    }
    var main = $('#hfMain');
    if (!main) return;
    clear(main);
    main.appendChild(el('div', { class: 'hf-loading', text: 'Loading...' }));
    var loader = pageLoaders[page];
    if (!loader) {
      main.innerHTML = '<div class="hf-empty">Unknown page.</div>';
      return;
    }
    loader().catch(function (err) {
      clear(main);
      main.appendChild(el('div', { class: 'hf-error', text: err.message || 'Error loading page' }));
    });
  }

  function signOut() {
    fetch('/auth/logout', { method: 'POST', credentials: 'same-origin' }).finally(function () {
      window.location.href = '/';
    });
  }

  // ── Setup wizard ──────────────────────────────────────────────────────
  function renderWizard() {
    var main = $('#hfMain');
    clear(main);

    var step = 1;
    var data = {
      household: { name: '', timezone: 'America/Chicago', address: '', zip: '' },
      members: [],
      seed: { chores: true, recipes: true, pantry: true }
    };

    var wrap = el('div', { class: 'hf-card' });
    main.appendChild(wrap);

    function render() {
      clear(wrap);
      wrap.appendChild(el('h2', { text: 'Welcome, ' + (state.user && state.user.displayName ? state.user.displayName : 'friend') + '!' }));
      wrap.appendChild(el('p', { class: 'hf-text-dim', text: 'Step ' + step + ' of 4' }));

      if (step === 1) renderStep1();
      if (step === 2) renderStep2();
      if (step === 3) renderStep3();
      if (step === 4) renderStep4();
    }

    function renderStep1() {
      wrap.appendChild(el('h3', { text: 'Create your household' }));
      var form = el('div');
      form.appendChild(field('Household name', 'text', data.household.name, function (v) { data.household.name = v; }, 'Smith Family'));
      form.appendChild(field('Timezone', 'text', data.household.timezone, function (v) { data.household.timezone = v; }));
      form.appendChild(field('Address (optional)', 'text', data.household.address, function (v) { data.household.address = v; }));
      form.appendChild(field('Zip (optional)', 'text', data.household.zip, function (v) { data.household.zip = v; }));
      wrap.appendChild(form);

      var actions = el('div', { class: 'hf-actions' }, [
        el('button', {
          class: 'hf-btn',
          type: 'button',
          on: { click: function () {
            if (!data.household.name.trim()) { toast('Household name is required'); return; }
            step = 2; render();
          } }
        }, ['Next'])
      ]);
      wrap.appendChild(actions);
    }

    function renderStep2() {
      wrap.appendChild(el('h3', { text: 'Add family members' }));
      wrap.appendChild(el('p', { class: 'hf-text-dim', text: 'You will be added as a parent automatically.' }));

      var list = el('div');
      function refreshList() {
        clear(list);
        if (data.members.length === 0) {
          list.appendChild(el('div', { class: 'hf-empty', text: 'No additional members yet.' }));
        } else {
          data.members.forEach(function (m, i) {
            list.appendChild(el('div', { class: 'hf-member-card' }, [
              el('div', { class: 'hf-avatar', text: m.avatar || (m.name[0] || '?').toUpperCase() }),
              el('div', { class: 'hf-meta' }, [
                el('div', { class: 'hf-name', text: m.name }),
                el('div', { class: 'hf-sub' }, [el('span', { class: 'hf-tag hf-tag-' + m.role, text: m.role })])
              ]),
              el('button', {
                class: 'hf-btn hf-btn-outline hf-btn-sm', type: 'button',
                on: { click: function () { data.members.splice(i, 1); refreshList(); } }
              }, ['Remove'])
            ]));
          });
        }
      }
      refreshList();
      wrap.appendChild(list);

      var memberForm = { name: '', role: 'kid', avatar: '' };
      wrap.appendChild(el('h3', { text: 'Add member' }));
      var name = field('Name', 'text', '', function (v) { memberForm.name = v; });
      wrap.appendChild(name);
      var roleField = el('div', { class: 'hf-field' }, [
        el('label', { text: 'Role' }),
        (function () {
          var sel = el('select', { class: 'hf-select' }, [
            el('option', { value: 'parent', text: 'Parent' }),
            el('option', { value: 'teen', text: 'Teen' }),
            el('option', { value: 'kid', text: 'Kid' })
          ]);
          sel.value = 'kid';
          sel.addEventListener('change', function () { memberForm.role = sel.value; });
          return sel;
        })()
      ]);
      wrap.appendChild(roleField);
      wrap.appendChild(field('Avatar (1-2 chars or emoji)', 'text', '', function (v) { memberForm.avatar = v; }));

      wrap.appendChild(el('div', { class: 'hf-actions' }, [
        el('button', {
          class: 'hf-btn hf-btn-outline', type: 'button',
          on: { click: function () {
            if (!memberForm.name.trim()) { toast('Name is required'); return; }
            data.members.push({ name: memberForm.name, role: memberForm.role, avatar: memberForm.avatar });
            memberForm.name = ''; memberForm.avatar = '';
            renderStep2();
          } }
        }, ['Add member']),
        el('button', {
          class: 'hf-btn', type: 'button',
          on: { click: function () { step = 3; render(); } }
        }, ['Next']),
        el('button', {
          class: 'hf-btn hf-btn-outline', type: 'button',
          on: { click: function () { step = 1; render(); } }
        }, ['Back'])
      ]));
    }

    function renderStep3() {
      wrap.appendChild(el('h3', { text: 'Quick start' }));
      wrap.appendChild(el('p', { class: 'hf-text-dim', text: 'We can pre-fill your home with sample data. You can edit or delete anything later.' }));

      function check(label, key) {
        var input = el('input', { type: 'checkbox' });
        input.checked = !!data.seed[key];
        input.addEventListener('change', function () { data.seed[key] = input.checked; });
        return el('label', { class: 'hf-checkbox' }, [input, el('span', { text: label })]);
      }
      wrap.appendChild(check('Start with sample chores', 'chores'));
      wrap.appendChild(check('Start with sample recipes', 'recipes'));
      wrap.appendChild(check('Start with sample pantry items', 'pantry'));

      wrap.appendChild(el('div', { class: 'hf-actions' }, [
        el('button', {
          class: 'hf-btn', type: 'button',
          on: { click: function () { step = 4; render(); submit(); } }
        }, ['Finish setup']),
        el('button', {
          class: 'hf-btn hf-btn-outline', type: 'button',
          on: { click: function () { step = 2; render(); } }
        }, ['Back'])
      ]));
    }

    function renderStep4() {
      wrap.appendChild(el('h3', { text: 'Setting things up...' }));
      wrap.appendChild(el('div', { class: 'hf-loading', text: 'Creating your household.' }));
    }

    function submit() {
      api('POST', '/setup', data).then(function (res) {
        state.household = res.household;
        state.members = res.members;
        state.isOwner = true;
        toast('Household ready');
        navigate('home');
      }).catch(function (err) {
        clear(wrap);
        wrap.appendChild(el('div', { class: 'hf-error', text: 'Setup failed: ' + (err.message || 'unknown') }));
        wrap.appendChild(el('button', {
          class: 'hf-btn', type: 'button', on: { click: function () { step = 1; render(); } }
        }, ['Try again']));
      });
    }

    render();
  }

  function field(label, type, value, onInput, placeholder) {
    var input = el('input', { type: type || 'text', class: 'hf-input', value: value || '' });
    if (placeholder) input.setAttribute('placeholder', placeholder);
    input.addEventListener('input', function () { onInput(input.value); });
    return el('div', { class: 'hf-field' }, [el('label', { text: label }), input]);
  }

  function selectField(label, value, options, onChange) {
    var sel = el('select', { class: 'hf-select' });
    options.forEach(function (o) {
      var opt = el('option', { value: o.value, text: o.label });
      sel.appendChild(opt);
    });
    sel.value = value;
    sel.addEventListener('change', function () { onChange(sel.value); });
    return el('div', { class: 'hf-field' }, [el('label', { text: label }), sel]);
  }

  function numberField(label, value, onInput, min, max) {
    var input = el('input', { type: 'number', class: 'hf-input', value: String(value) });
    if (min != null) input.setAttribute('min', String(min));
    if (max != null) input.setAttribute('max', String(max));
    input.addEventListener('input', function () { onInput(parseFloat(input.value || '0')); });
    return el('div', { class: 'hf-field' }, [el('label', { text: label }), input]);
  }

  // ── Modal ─────────────────────────────────────────────────────────────
  function openModal(title, contentBuilder) {
    var bd = el('div', { class: 'hf-modal-backdrop' });
    var modal = el('div', { class: 'hf-modal' });
    bd.appendChild(modal);
    document.body.appendChild(bd);
    function close() { document.body.removeChild(bd); }
    bd.addEventListener('click', function (e) { if (e.target === bd) close(); });
    modal.appendChild(el('h2', { text: title }));
    var body = el('div');
    modal.appendChild(body);
    contentBuilder(body, close);
  }

  // ── Pages ─────────────────────────────────────────────────────────────
  var pageLoaders = {
    'home': renderHome,
    'chores': renderChores,
    'meal-plan': renderMealPlan,
    'recipes': renderRecipes,
    'pantry': renderPantry,
    'shopping': renderShopping,
    'settings': renderSettings
  };

  // ── Home / Dashboard ──────────────────────────────────────────────────
  function renderHome() {
    return api('GET', '/dashboard').then(function (d) {
      var main = $('#hfMain'); clear(main);

      // Today's chores per member
      var choresCard = el('div', { class: 'hf-card' });
      choresCard.appendChild(el('h2', { text: "Today's chores" }));
      if (!d.todayChoresPerMember || d.todayChoresPerMember.length === 0) {
        choresCard.appendChild(el('div', { class: 'hf-empty' }, [
          el('strong', { text: 'No members yet' }),
          'Add family members in Settings.'
        ]));
      } else {
        var grid = el('div', { class: 'hf-grid hf-grid-2' });
        d.todayChoresPerMember.forEach(function (m) {
          var card = el('div', { class: 'hf-member-card' }, [
            el('div', { class: 'hf-avatar', text: m.member.avatar || m.member.name[0] }),
            el('div', { class: 'hf-meta' }, [
              el('div', { class: 'hf-name', text: m.member.name }),
              el('div', { class: 'hf-sub', text: (m.chores.length || 0) + ' chores available' + (m.member.xpVisible ? ', ' + (m.member.xpTotal || 0) + ' XP' : '') })
            ])
          ]);
          grid.appendChild(card);
        });
        choresCard.appendChild(grid);
      }
      main.appendChild(choresCard);

      // Tonight's meal
      var mealCard = el('div', { class: 'hf-card' });
      mealCard.appendChild(el('h2', { text: "Tonight's meal" }));
      if (!d.tonight) {
        mealCard.appendChild(el('div', { class: 'hf-empty' }, [
          el('strong', { text: 'No dinner planned' }),
          'Plan one in Meal Plan.'
        ]));
      } else if (d.tonight.recipeId) {
        api('GET', '/recipes').then(function (recipes) {
          var r = recipes.find(function (x) { return x.id === d.tonight.recipeId; });
          mealCard.appendChild(el('div', { text: r ? r.title : 'Selected recipe' }));
        });
      } else if (d.tonight.freeText) {
        mealCard.appendChild(el('div', { text: d.tonight.freeText }));
      }
      main.appendChild(mealCard);

      // Low stock
      var stockCard = el('div', { class: 'hf-card' });
      stockCard.appendChild(el('h2', null, [
        'Low stock ',
        el('span', { class: 'hf-tag hf-tag-low', text: String(d.lowStockCount || 0) })
      ]));
      if (!d.lowStock || d.lowStock.length === 0) {
        stockCard.appendChild(el('div', { class: 'hf-empty', text: 'All pantry items above threshold.' }));
      } else {
        d.lowStock.forEach(function (it) {
          stockCard.appendChild(el('div', { class: 'hf-row' }, [
            el('div', { class: 'hf-meta', text: it.name }),
            el('div', { class: 'hf-sub', text: it.qty + ' ' + it.unit }),
            el('span', { class: 'hf-tag hf-tag-low', text: it.location })
          ]));
        });
      }
      main.appendChild(stockCard);

      // Recent XP gains
      var xpCard = el('div', { class: 'hf-card' });
      xpCard.appendChild(el('h2', { text: 'Recent XP gains' }));
      if (!d.recentCompletions || d.recentCompletions.length === 0) {
        xpCard.appendChild(el('div', { class: 'hf-empty', text: 'No completions yet. Get the family started!' }));
      } else {
        d.recentCompletions.forEach(function (c) {
          xpCard.appendChild(el('div', { class: 'hf-row' }, [
            el('div', { class: 'hf-meta' }, [
              el('div', { class: 'hf-name', text: c.memberName + ' completed ' + c.choreName }),
              el('div', { class: 'hf-sub', text: fmtTime(c.completedAt) })
            ]),
            el('span', { class: 'hf-chore-xp', text: '+' + c.xpAwarded + ' XP' })
          ]));
        });
      }
      main.appendChild(xpCard);
    });
  }

  // ── Chores ────────────────────────────────────────────────────────────
  function renderChores() {
    return Promise.all([api('GET', '/chores'), api('GET', '/members')]).then(function (results) {
      var chores = results[0];
      var members = results[1];
      var main = $('#hfMain'); clear(main);

      var card = el('div', { class: 'hf-card' });
      card.appendChild(el('h2', null, [
        'Chores',
        el('button', {
          class: 'hf-btn hf-btn-sm',
          style: 'float: right;',
          type: 'button',
          on: { click: function () { openChoreModal(null, members, refresh); } }
        }, ['+ Add chore'])
      ]));

      if (!chores.length) {
        card.appendChild(el('div', { class: 'hf-empty' }, [
          el('strong', { text: 'No chores yet' }),
          'Add the first one to start earning XP.'
        ]));
      } else {
        chores.forEach(function (c) {
          var assigneeLabel = c.assignee === 'anyone' ? 'Anyone' :
                              c.assignee === 'rotation' ? 'Rotation' :
                              ((members.find(function (m) { return m.id === c.assignee; }) || {}).name || 'Unknown');
          var item = el('div', { class: 'hf-chore-item' }, [
            el('button', {
              class: 'hf-chore-check', type: 'button', title: 'Mark complete',
              on: { click: function () { completeChore(c, members, refresh); } }
            }, ['✓']),
            el('div', { class: 'hf-meta' }, [
              el('div', { class: 'hf-chore-name', text: c.name }),
              el('div', { class: 'hf-chore-sub', text: c.frequency + ', ' + assigneeLabel + (c.category ? ', ' + c.category : '') })
            ]),
            el('span', { class: 'hf-chore-xp', text: '+' + c.xpReward + ' XP' }),
            el('button', {
              class: 'hf-btn hf-btn-outline hf-btn-sm', type: 'button',
              on: { click: function () { openChoreModal(c, members, refresh); } }
            }, ['Edit']),
            el('button', {
              class: 'hf-btn hf-btn-outline hf-btn-sm', type: 'button',
              on: { click: function () { showHistory(c); } }
            }, ['History'])
          ]);
          card.appendChild(item);
        });
      }
      main.appendChild(card);
    });

    function refresh() { navigate('chores'); }
  }

  function completeChore(chore, members, refresh) {
    if (!members.length) { toast('Add a family member first'); return; }
    if (members.length === 1) {
      api('POST', '/chores/' + chore.id + '/complete', { memberId: members[0].id })
        .then(function () { toast('+' + chore.xpReward + ' XP awarded'); refresh(); });
      return;
    }
    openModal('Who completed ' + chore.name + '?', function (body, close) {
      members.forEach(function (m) {
        body.appendChild(el('button', {
          class: 'hf-btn hf-btn-outline', style: 'margin: 4px;', type: 'button',
          on: { click: function () {
            api('POST', '/chores/' + chore.id + '/complete', { memberId: m.id })
              .then(function () { toast('+' + chore.xpReward + ' XP to ' + m.name); close(); refresh(); });
          } }
        }, [m.name]));
      });
    });
  }

  function showHistory(chore) {
    api('GET', '/chores/' + chore.id + '/history').then(function (history) {
      openModal(chore.name + ' history', function (body) {
        if (!history.length) {
          body.appendChild(el('div', { class: 'hf-empty', text: 'No completions yet.' }));
          return;
        }
        history.forEach(function (h) {
          body.appendChild(el('div', { class: 'hf-row' }, [
            el('div', { class: 'hf-meta', text: fmtTime(h.completedAt) }),
            el('span', { class: 'hf-tag', text: '+' + h.xpAwarded + ' XP' })
          ]));
        });
      });
    });
  }

  function openChoreModal(chore, members, onSaved) {
    openModal(chore ? 'Edit chore' : 'New chore', function (body, close) {
      var data = chore ? Object.assign({}, chore) : {
        name: '', description: '', frequency: 'weekly', assignee: 'anyone', xpReward: 5, category: ''
      };
      body.appendChild(field('Name', 'text', data.name, function (v) { data.name = v; }));
      body.appendChild(field('Description', 'text', data.description || '', function (v) { data.description = v; }));
      body.appendChild(selectField('Frequency', data.frequency, [
        { value: 'once', label: 'Once' },
        { value: 'daily', label: 'Daily' },
        { value: 'weekly', label: 'Weekly' },
        { value: 'custom', label: 'Custom' }
      ], function (v) { data.frequency = v; }));

      var assigneeOptions = [
        { value: 'anyone', label: 'Anyone' },
        { value: 'rotation', label: 'Rotation' }
      ].concat(members.map(function (m) { return { value: m.id, label: m.name }; }));
      body.appendChild(selectField('Assignee', data.assignee, assigneeOptions, function (v) { data.assignee = v; }));

      body.appendChild(numberField('XP reward', data.xpReward, function (v) { data.xpReward = v; }, 0));
      body.appendChild(field('Category (optional)', 'text', data.category || '', function (v) { data.category = v; }));

      var actions = el('div', { class: 'hf-actions' });
      actions.appendChild(el('button', {
        class: 'hf-btn', type: 'button',
        on: { click: function () {
          var payload = {
            name: data.name, description: data.description, frequency: data.frequency,
            assignee: data.assignee, xpReward: parseInt(data.xpReward, 10) || 0,
            category: data.category || null
          };
          var p = chore ? api('PATCH', '/chores/' + chore.id, payload) : api('POST', '/chores', payload);
          p.then(function () { close(); onSaved(); }).catch(function (err) { toast(err.message); });
        } }
      }, [chore ? 'Save' : 'Add']));
      if (chore) {
        actions.appendChild(el('button', {
          class: 'hf-btn hf-btn-danger', type: 'button',
          on: { click: function () {
            if (!window.confirm('Delete chore "' + chore.name + '"?')) return;
            api('DELETE', '/chores/' + chore.id).then(function () { close(); onSaved(); });
          } }
        }, ['Delete']));
      }
      actions.appendChild(el('button', { class: 'hf-btn hf-btn-outline', type: 'button', on: { click: close } }, ['Cancel']));
      body.appendChild(actions);
    });
  }

  // ── Recipes ───────────────────────────────────────────────────────────
  function renderRecipes() {
    return api('GET', '/recipes').then(function (recipes) {
      var main = $('#hfMain'); clear(main);
      var card = el('div', { class: 'hf-card' });
      card.appendChild(el('h2', null, [
        'Recipes',
        el('button', {
          class: 'hf-btn hf-btn-sm', style: 'float: right;', type: 'button',
          on: { click: function () { openRecipeModal(null, function () { navigate('recipes'); }); } }
        }, ['+ Add recipe'])
      ]));
      if (!recipes.length) {
        card.appendChild(el('div', { class: 'hf-empty' }, [
          el('strong', { text: 'No recipes yet' }),
          'Add your favorites so you can plan meals.'
        ]));
      } else {
        recipes.forEach(function (r) {
          card.appendChild(el('div', { class: 'hf-row' }, [
            el('div', { class: 'hf-meta' }, [
              el('div', { class: 'hf-name', text: r.title }),
              el('div', { class: 'hf-sub', text: (r.prepMinutes + r.cookMinutes) + ' min, ' + (r.tags || []).join(', ') })
            ]),
            el('button', {
              class: 'hf-btn hf-btn-outline hf-btn-sm', type: 'button',
              on: { click: function () { openRecipeModal(r, function () { navigate('recipes'); }); } }
            }, ['View'])
          ]));
        });
      }
      main.appendChild(card);
    });
  }

  function openRecipeModal(recipe, onSaved) {
    openModal(recipe ? recipe.title : 'New recipe', function (body, close) {
      var data = recipe ? JSON.parse(JSON.stringify(recipe)) : {
        title: '', ingredients: [], steps: '', prepMinutes: 0, cookMinutes: 0, tags: []
      };
      body.appendChild(field('Title', 'text', data.title, function (v) { data.title = v; }));

      body.appendChild(el('h3', { text: 'Ingredients' }));
      var ingList = el('div');
      function refreshIngs() {
        clear(ingList);
        data.ingredients.forEach(function (ing, i) {
          ingList.appendChild(el('div', { class: 'hf-row' }, [
            el('div', { class: 'hf-meta', text: ing.qty + ' ' + ing.unit + ' ' + ing.name }),
            el('button', {
              class: 'hf-btn hf-btn-outline hf-btn-sm', type: 'button',
              on: { click: function () { data.ingredients.splice(i, 1); refreshIngs(); } }
            }, ['Remove'])
          ]));
        });
      }
      refreshIngs();
      body.appendChild(ingList);

      var ingForm = { name: '', qty: 1, unit: '' };
      var ingFields = el('div');
      ingFields.appendChild(field('Ingredient name', 'text', '', function (v) { ingForm.name = v; }));
      ingFields.appendChild(numberField('Quantity', 1, function (v) { ingForm.qty = v; }, 0));
      ingFields.appendChild(field('Unit', 'text', '', function (v) { ingForm.unit = v; }));
      body.appendChild(ingFields);
      body.appendChild(el('button', {
        class: 'hf-btn hf-btn-outline hf-btn-sm', type: 'button',
        on: { click: function () {
          if (!ingForm.name.trim()) { toast('Ingredient name required'); return; }
          data.ingredients.push({ name: ingForm.name, qty: ingForm.qty, unit: ingForm.unit });
          ingForm.name = ''; ingForm.qty = 1; ingForm.unit = '';
          // Clear the input fields visually by re-rendering
          clear(ingFields);
          ingFields.appendChild(field('Ingredient name', 'text', '', function (v) { ingForm.name = v; }));
          ingFields.appendChild(numberField('Quantity', 1, function (v) { ingForm.qty = v; }, 0));
          ingFields.appendChild(field('Unit', 'text', '', function (v) { ingForm.unit = v; }));
          refreshIngs();
        } }
      }, ['Add ingredient']));

      body.appendChild(el('div', { class: 'hf-field' }, [
        el('label', { text: 'Steps (markdown ok)' }),
        (function () {
          var t = el('textarea', { class: 'hf-textarea' });
          t.value = data.steps;
          t.addEventListener('input', function () { data.steps = t.value; });
          return t;
        })()
      ]));

      body.appendChild(numberField('Prep minutes', data.prepMinutes, function (v) { data.prepMinutes = v; }, 0));
      body.appendChild(numberField('Cook minutes', data.cookMinutes, function (v) { data.cookMinutes = v; }, 0));
      body.appendChild(field('Tags (comma separated)', 'text', (data.tags || []).join(', '), function (v) { data.tags = v.split(',').map(function (s) { return s.trim(); }).filter(Boolean); }));

      var actions = el('div', { class: 'hf-actions' });
      actions.appendChild(el('button', {
        class: 'hf-btn', type: 'button',
        on: { click: function () {
          if (!data.title.trim()) { toast('Title required'); return; }
          var payload = {
            title: data.title,
            ingredients: data.ingredients,
            steps: data.steps,
            prepMinutes: parseInt(data.prepMinutes, 10) || 0,
            cookMinutes: parseInt(data.cookMinutes, 10) || 0,
            tags: data.tags
          };
          var p = recipe ? api('PATCH', '/recipes/' + recipe.id, payload) : api('POST', '/recipes', payload);
          p.then(function () { close(); onSaved(); }).catch(function (err) { toast(err.message); });
        } }
      }, [recipe ? 'Save' : 'Add']));
      if (recipe) {
        actions.appendChild(el('button', {
          class: 'hf-btn hf-btn-danger', type: 'button',
          on: { click: function () {
            if (!window.confirm('Delete this recipe?')) return;
            api('DELETE', '/recipes/' + recipe.id).then(function () { close(); onSaved(); });
          } }
        }, ['Delete']));
      }
      actions.appendChild(el('button', { class: 'hf-btn hf-btn-outline', type: 'button', on: { click: close } }, ['Cancel']));
      body.appendChild(actions);
    });
  }

  // ── Meal plan ─────────────────────────────────────────────────────────
  function renderMealPlan() {
    return Promise.all([api('GET', '/meal-plan'), api('GET', '/recipes')]).then(function (results) {
      var plan = results[0];
      var recipes = results[1];
      var main = $('#hfMain'); clear(main);

      var weekStart = plan.weekStart || todayIso();
      var dates = [];
      var ws = new Date(weekStart + 'T00:00:00Z');
      for (var i = 0; i < 7; i++) {
        var d = new Date(ws);
        d.setUTCDate(d.getUTCDate() + i);
        dates.push(d.toISOString().slice(0, 10));
      }

      var card = el('div', { class: 'hf-card' });
      card.appendChild(el('h2', { text: 'Meal Plan' }));
      card.appendChild(el('div', { class: 'hf-sub', text: 'Week of ' + weekStart }));

      var grid = el('div', { class: 'hf-meal-grid' });
      grid.appendChild(el('div', { class: 'hf-meal-head', text: '' }));
      ['Breakfast', 'Lunch', 'Dinner'].forEach(function (slot) {
        grid.appendChild(el('div', { class: 'hf-meal-head', text: slot }));
      });
      var slots = ['breakfast', 'lunch', 'dinner'];
      dates.forEach(function (date) {
        var day = new Date(date + 'T00:00:00Z');
        var label = day.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
        grid.appendChild(el('div', { class: 'hf-meal-head', text: label }));
        slots.forEach(function (slot) {
          var entry = (plan.slots[date] || {})[slot] || null;
          var label2;
          if (entry && entry.recipeId) {
            var r = recipes.find(function (x) { return x.id === entry.recipeId; });
            label2 = r ? r.title : 'Recipe';
          } else if (entry && entry.freeText) {
            label2 = entry.freeText;
          } else {
            label2 = '+ add';
          }
          var slotCell = el('div', { class: 'hf-meal-slot' + (entry ? '' : ' hf-meal-slot-empty'), text: label2 });
          slotCell.addEventListener('click', function () { openMealSlotEditor(date, slot, entry, recipes); });
          grid.appendChild(slotCell);
        });
      });
      card.appendChild(grid);

      card.appendChild(el('div', { class: 'hf-actions' }, [
        el('button', {
          class: 'hf-btn', type: 'button',
          on: { click: function () {
            api('POST', '/meal-plan/generate-shopping-list').then(function (res) {
              toast('Added ' + res.added + ' items to shopping list');
            });
          } }
        }, ['Generate shopping list'])
      ]));

      main.appendChild(card);
    });
  }

  function openMealSlotEditor(date, slot, current, recipes) {
    openModal(date + ' ' + slot, function (body, close) {
      var mode = current && current.freeText ? 'freetext' : 'recipe';
      var pickedRecipeId = current && current.recipeId ? current.recipeId : '';
      var freeText = current && current.freeText ? current.freeText : '';
      var modeRow = el('div', { class: 'hf-pill-row' });
      var pillRecipe = el('button', { class: 'hf-pill' + (mode === 'recipe' ? ' active' : ''), type: 'button', text: 'Recipe' });
      var pillFree = el('button', { class: 'hf-pill' + (mode === 'freetext' ? ' active' : ''), type: 'button', text: 'Free text' });
      modeRow.appendChild(pillRecipe); modeRow.appendChild(pillFree);
      body.appendChild(modeRow);
      var content = el('div');
      body.appendChild(content);

      function renderMode() {
        clear(content);
        pillRecipe.classList.toggle('active', mode === 'recipe');
        pillFree.classList.toggle('active', mode === 'freetext');
        if (mode === 'recipe') {
          var sel = el('select', { class: 'hf-select' });
          sel.appendChild(el('option', { value: '', text: '- Pick a recipe -' }));
          recipes.forEach(function (r) { sel.appendChild(el('option', { value: r.id, text: r.title })); });
          sel.value = pickedRecipeId;
          sel.addEventListener('change', function () { pickedRecipeId = sel.value; });
          content.appendChild(sel);
        } else {
          content.appendChild(field('What is for ' + slot + '?', 'text', freeText, function (v) { freeText = v; }));
        }
      }
      pillRecipe.addEventListener('click', function () { mode = 'recipe'; renderMode(); });
      pillFree.addEventListener('click', function () { mode = 'freetext'; renderMode(); });
      renderMode();

      body.appendChild(el('div', { class: 'hf-actions' }, [
        el('button', {
          class: 'hf-btn', type: 'button',
          on: { click: function () {
            var entry;
            if (mode === 'recipe') {
              if (!pickedRecipeId) { toast('Pick a recipe'); return; }
              entry = { recipeId: pickedRecipeId };
            } else {
              if (!freeText.trim()) { toast('Enter a meal'); return; }
              entry = { freeText: freeText };
            }
            api('PUT', '/meal-plan/slot', { date: date, slot: slot, entry: entry }).then(function () { close(); navigate('meal-plan'); });
          } }
        }, ['Save']),
        el('button', {
          class: 'hf-btn hf-btn-outline', type: 'button',
          on: { click: function () {
            api('PUT', '/meal-plan/slot', { date: date, slot: slot, entry: null }).then(function () { close(); navigate('meal-plan'); });
          } }
        }, ['Clear']),
        el('button', { class: 'hf-btn hf-btn-outline', type: 'button', on: { click: close } }, ['Cancel'])
      ]));
    });
  }

  // ── Pantry ────────────────────────────────────────────────────────────
  function renderPantry() {
    return api('GET', '/pantry').then(function (items) {
      var main = $('#hfMain'); clear(main);
      var filter = state.cache.pantryFilter || 'all';
      var card = el('div', { class: 'hf-card' });
      card.appendChild(el('h2', null, [
        'Pantry',
        el('button', {
          class: 'hf-btn hf-btn-sm', style: 'float: right;', type: 'button',
          on: { click: function () { openPantryModal(null, function () { navigate('pantry'); }); } }
        }, ['+ Add item'])
      ]));

      var pills = el('div', { class: 'hf-pill-row' });
      ['all', 'fridge', 'pantry', 'freezer', 'other', 'low'].forEach(function (f) {
        var p = el('button', { class: 'hf-pill' + (filter === f ? ' active' : ''), type: 'button', text: f });
        p.addEventListener('click', function () { state.cache.pantryFilter = f; navigate('pantry'); });
        pills.appendChild(p);
      });
      card.appendChild(pills);

      var filtered = items.filter(function (it) {
        if (filter === 'all') return true;
        if (filter === 'low') return it.qty <= it.lowStockThreshold;
        return it.location === filter;
      });

      if (!filtered.length) {
        card.appendChild(el('div', { class: 'hf-empty' }, [
          el('strong', { text: 'Nothing here' }),
          filter === 'all' ? 'Add your first pantry item.' : 'No items match this filter.'
        ]));
      } else {
        var groups = {};
        filtered.forEach(function (it) {
          (groups[it.location] = groups[it.location] || []).push(it);
        });
        Object.keys(groups).forEach(function (loc) {
          card.appendChild(el('h3', { text: loc }));
          groups[loc].forEach(function (it) {
            var low = it.qty <= it.lowStockThreshold;
            card.appendChild(el('div', { class: 'hf-row' }, [
              el('div', { class: 'hf-meta' }, [
                el('div', { class: 'hf-name', text: it.name }),
                el('div', { class: 'hf-sub', text: it.qty + ' ' + it.unit + (low ? ' (low)' : '') })
              ]),
              low ? el('span', { class: 'hf-tag hf-tag-low', text: 'LOW' }) : null,
              el('button', {
                class: 'hf-btn hf-btn-outline hf-btn-sm', type: 'button',
                on: { click: function () { openPantryModal(it, function () { navigate('pantry'); }); } }
              }, ['Edit'])
            ]));
          });
        });
      }
      main.appendChild(card);
    });
  }

  function openPantryModal(item, onSaved) {
    openModal(item ? 'Edit ' + item.name : 'New pantry item', function (body, close) {
      var data = item ? Object.assign({}, item) : {
        name: '', qty: 1, unit: '', location: 'pantry', lowStockThreshold: 1
      };
      body.appendChild(field('Name', 'text', data.name, function (v) { data.name = v; }));
      body.appendChild(numberField('Quantity', data.qty, function (v) { data.qty = v; }, 0));
      body.appendChild(field('Unit', 'text', data.unit, function (v) { data.unit = v; }));
      body.appendChild(selectField('Location', data.location, [
        { value: 'fridge', label: 'Fridge' },
        { value: 'pantry', label: 'Pantry' },
        { value: 'freezer', label: 'Freezer' },
        { value: 'other', label: 'Other' }
      ], function (v) { data.location = v; }));
      body.appendChild(numberField('Low-stock threshold', data.lowStockThreshold, function (v) { data.lowStockThreshold = v; }, 0));

      var actions = el('div', { class: 'hf-actions' });
      actions.appendChild(el('button', {
        class: 'hf-btn', type: 'button',
        on: { click: function () {
          var payload = {
            name: data.name,
            qty: parseFloat(data.qty) || 0,
            unit: data.unit || 'each',
            location: data.location,
            lowStockThreshold: parseFloat(data.lowStockThreshold) || 0
          };
          var p = item ? api('PATCH', '/pantry/' + item.id, payload) : api('POST', '/pantry', payload);
          p.then(function () { close(); onSaved(); }).catch(function (err) { toast(err.message); });
        } }
      }, [item ? 'Save' : 'Add']));
      if (item) {
        actions.appendChild(el('button', {
          class: 'hf-btn hf-btn-danger', type: 'button',
          on: { click: function () {
            if (!window.confirm('Delete ' + item.name + '?')) return;
            api('DELETE', '/pantry/' + item.id).then(function () { close(); onSaved(); });
          } }
        }, ['Delete']));
      }
      actions.appendChild(el('button', { class: 'hf-btn hf-btn-outline', type: 'button', on: { click: close } }, ['Cancel']));
      body.appendChild(actions);
    });
  }

  // ── Shopping list ─────────────────────────────────────────────────────
  function renderShopping() {
    return api('GET', '/shopping').then(function (items) {
      var main = $('#hfMain'); clear(main);
      var card = el('div', { class: 'hf-card' });
      card.appendChild(el('h2', { text: 'Shopping list' }));

      var addRow = el('div', { class: 'hf-actions', style: 'margin-bottom: 12px;' });
      var input = el('input', { class: 'hf-input', type: 'text', placeholder: 'Add item, e.g. bread', style: 'flex: 1;' });
      addRow.appendChild(input);
      addRow.appendChild(el('button', {
        class: 'hf-btn', type: 'button',
        on: { click: function () {
          if (!input.value.trim()) return;
          api('POST', '/shopping', { name: input.value, source: 'manual' }).then(function () {
            input.value = '';
            navigate('shopping');
          });
        } }
      }, ['Add']));
      card.appendChild(addRow);

      if (!items.length) {
        card.appendChild(el('div', { class: 'hf-empty' }, [
          el('strong', { text: 'Empty list' }),
          'Pantry low-stock and meal plan items show up here.'
        ]));
      } else {
        items.forEach(function (it) {
          var row = el('div', { class: 'hf-shopping-row' + (it.checked ? ' checked' : '') });
          var cb = el('input', { type: 'checkbox' });
          cb.checked = !!it.checked;
          cb.addEventListener('change', function () {
            var patch = { checked: cb.checked };
            if (cb.checked && it.source === 'pantry' && it.sourceRefId) {
              var newQty = window.prompt('Restock ' + it.name + '. New quantity?');
              if (newQty !== null && !isNaN(parseFloat(newQty))) {
                patch.qty = parseFloat(newQty);
              }
            }
            api('PATCH', '/shopping/' + it.id, patch).then(function () { navigate('shopping'); });
          });
          row.appendChild(cb);
          row.appendChild(el('div', { class: 'hf-meta' }, [
            el('div', { class: 'hf-shopping-name', text: it.name + (it.qty != null ? ' (' + it.qty + (it.unit ? ' ' + it.unit : '') + ')' : '') }),
            el('div', { class: 'hf-sub', text: 'source: ' + it.source })
          ]));
          row.appendChild(el('span', { class: 'hf-tag hf-tag-source', text: it.source }));
          row.appendChild(el('button', {
            class: 'hf-btn hf-btn-outline hf-btn-sm', type: 'button',
            on: { click: function () {
              if (!window.confirm('Remove ' + it.name + '?')) return;
              api('DELETE', '/shopping/' + it.id).then(function () { navigate('shopping'); });
            } }
          }, ['Remove']));
          card.appendChild(row);
        });
      }
      main.appendChild(card);
    });
  }

  // ── Settings ──────────────────────────────────────────────────────────
  function renderSettings() {
    return Promise.all([api('GET', '/household'), api('GET', '/members')]).then(function (results) {
      var hh = results[0];
      var members = results[1];
      var main = $('#hfMain'); clear(main);

      // Household card
      var hhCard = el('div', { class: 'hf-card' });
      hhCard.appendChild(el('h2', { text: 'Household' }));
      var data = { name: hh.name, timezone: hh.timezone };
      hhCard.appendChild(field('Name', 'text', data.name, function (v) { data.name = v; }));
      hhCard.appendChild(field('Timezone', 'text', data.timezone, function (v) { data.timezone = v; }));
      hhCard.appendChild(el('div', { class: 'hf-actions' }, [
        el('button', {
          class: 'hf-btn', type: 'button',
          on: { click: function () {
            api('PATCH', '/household', { name: data.name, timezone: data.timezone })
              .then(function () { toast('Saved'); });
          } }
        }, ['Save household']),
        el('button', {
          class: 'hf-btn hf-btn-outline hf-btn-danger', type: 'button',
          on: { click: function () {
            if (!window.confirm('Archive household? You can still see data, but it will be marked archived.')) return;
            api('POST', '/household/archive').then(function () { toast('Archived'); });
          } }
        }, ['Archive household'])
      ]));
      main.appendChild(hhCard);

      // Members card
      var memCard = el('div', { class: 'hf-card' });
      memCard.appendChild(el('h2', null, [
        'Members',
        el('button', {
          class: 'hf-btn hf-btn-sm', style: 'float: right;', type: 'button',
          on: { click: function () { openMemberModal(null, function () { navigate('settings'); }); } }
        }, ['+ Add member'])
      ]));
      if (!members.length) {
        memCard.appendChild(el('div', { class: 'hf-empty', text: 'No members yet.' }));
      } else {
        members.forEach(function (m) {
          memCard.appendChild(el('div', { class: 'hf-member-card' }, [
            el('div', { class: 'hf-avatar', text: m.avatar || (m.name[0] || '?').toUpperCase() }),
            el('div', { class: 'hf-meta' }, [
              el('div', { class: 'hf-name', text: m.name }),
              el('div', { class: 'hf-sub' }, [
                el('span', { class: 'hf-tag hf-tag-' + m.role, text: m.role }),
                ' ',
                el('span', { text: (m.xpVisible ? m.xpTotal + ' XP' : 'XP hidden') })
              ])
            ]),
            el('button', {
              class: 'hf-btn hf-btn-outline hf-btn-sm', type: 'button',
              on: { click: function () { openMemberModal(m, function () { navigate('settings'); }); } }
            }, ['Edit'])
          ]));
        });
      }
      main.appendChild(memCard);
    });
  }

  function openMemberModal(member, onSaved) {
    openModal(member ? 'Edit member' : 'New member', function (body, close) {
      var data = member ? Object.assign({}, member) : { name: '', role: 'kid', avatar: '', xpVisible: true };
      body.appendChild(field('Name', 'text', data.name, function (v) { data.name = v; }));
      body.appendChild(selectField('Role', data.role, [
        { value: 'parent', label: 'Parent' },
        { value: 'teen', label: 'Teen' },
        { value: 'kid', label: 'Kid' }
      ], function (v) { data.role = v; }));
      body.appendChild(field('Avatar (1-2 chars or emoji)', 'text', data.avatar || '', function (v) { data.avatar = v; }));
      var xpLabel = el('label', { class: 'hf-checkbox' });
      var xpInput = el('input', { type: 'checkbox' });
      xpInput.checked = !!data.xpVisible;
      xpInput.addEventListener('change', function () { data.xpVisible = xpInput.checked; });
      xpLabel.appendChild(xpInput);
      xpLabel.appendChild(el('span', { text: 'Show XP publicly' }));
      body.appendChild(xpLabel);

      var actions = el('div', { class: 'hf-actions' });
      actions.appendChild(el('button', {
        class: 'hf-btn', type: 'button',
        on: { click: function () {
          if (!data.name.trim()) { toast('Name required'); return; }
          var payload = { name: data.name, role: data.role, avatar: data.avatar || data.name[0].toUpperCase(), xpVisible: data.xpVisible };
          var p = member ? api('PATCH', '/members/' + member.id, payload) : api('POST', '/members', payload);
          p.then(function () { close(); onSaved(); }).catch(function (err) { toast(err.message); });
        } }
      }, [member ? 'Save' : 'Add']));
      if (member) {
        actions.appendChild(el('button', {
          class: 'hf-btn hf-btn-danger', type: 'button',
          on: { click: function () {
            if (!window.confirm('Remove ' + member.name + '?')) return;
            api('DELETE', '/members/' + member.id).then(function () { close(); onSaved(); });
          } }
        }, ['Remove']));
      }
      actions.appendChild(el('button', { class: 'hf-btn hf-btn-outline', type: 'button', on: { click: close } }, ['Cancel']));
      body.appendChild(actions);
    });
  }

  // ── Universal Times Season strip ──────────────────────────────────────
  function startSeasonStrip() {
    function tick() {
      fetch(TEMPORAL_NOW, { credentials: 'same-origin' }).then(function (r) {
        if (!r.ok) throw new Error('temporal_unreachable');
        return r.json();
      }).then(function (now) {
        var label = $('#hfSeasonName');
        var bar = $('#hfSeasonBar');
        if (label) label.textContent = 'Season ' + (now.season != null ? now.season : '?');
        if (bar) bar.style.width = (Math.max(0, Math.min(1, now.seasonFrac || 0)) * 100).toFixed(1) + '%';
      }).catch(function () {
        var label = $('#hfSeasonName');
        if (label) label.textContent = 'offline';
      });
    }
    tick();
    setInterval(tick, 30000);
  }

  // ── Boot ──────────────────────────────────────────────────────────────
  document.addEventListener('DOMContentLoaded', bootstrap);
})();
