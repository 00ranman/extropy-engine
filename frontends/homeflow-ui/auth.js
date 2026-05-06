/* ============================================
   HomeFlow Family Pilot, Auth Gate
   ============================================
   Handles the login screen, the DID onboarding wizard, and the per user
   header chip. Talks to /auth/me and /api/v1/identity/* on the same origin.
   Exposes window.HomeFlowAuth for the rest of the app.
*/

(function () {
  'use strict';

  var state = {
    user: null,
    ready: false,
    listeners: []
  };

  function onReady(fn) {
    if (state.ready) { fn(state.user); return; }
    state.listeners.push(fn);
  }

  function emitReady() {
    state.ready = true;
    state.listeners.forEach(function (fn) { try { fn(state.user); } catch (e) { console.error(e); } });
    state.listeners = [];
  }

  function api(method, path, body) {
    var opts = {
      method: method,
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' }
    };
    if (body !== undefined) opts.body = JSON.stringify(body);
    return fetch(path, opts).then(function (res) {
      return res.text().then(function (text) {
        var data;
        try { data = text ? JSON.parse(text) : {}; } catch (_e) { data = { raw: text }; }
        if (!res.ok) {
          var err = new Error((data && data.error) || ('HTTP ' + res.status));
          err.status = res.status;
          err.data = data;
          throw err;
        }
        return data;
      });
    });
  }

  // ── Login screen ───────────────────────────────────────────────────────
  function renderLogin(message) {
    document.body.innerHTML = '';
    var wrap = document.createElement('div');
    wrap.className = 'auth-screen';
    wrap.innerHTML = ''
      + '<div class="auth-card">'
      + '  <div class="auth-logo">&#9851; HomeFlow</div>'
      + '  <h1>Sign in to HomeFlow</h1>'
      + '  <p class="auth-sub">Family pilot. Each member gets a real did:extropy identity.</p>'
      + '  <a class="auth-google-btn" href="/auth/google">'
      + '    <span class="auth-google-icon">G</span>'
      + '    <span>Continue with Google</span>'
      + '  </a>'
      + (message ? '<p class="auth-message">' + escapeHtml(message) + '</p>' : '')
      + '  <p class="auth-foot">Your private key is generated in this browser and never leaves your device.</p>'
      + '</div>';
    document.body.appendChild(wrap);
  }

  function escapeHtml(str) {
    var div = document.createElement('div');
    div.textContent = String(str);
    return div.innerHTML;
  }

  // ── User chip in header ────────────────────────────────────────────────
  function renderUserChip(user) {
    var existing = document.getElementById('hfUserChip');
    if (existing) existing.remove();
    var headerRight = document.querySelector('.header-right');
    if (!headerRight) return;
    var chip = document.createElement('div');
    chip.id = 'hfUserChip';
    chip.className = 'user-chip';
    var didShort = user.did ? (user.did.slice(0, 18) + '...' + user.did.slice(-6)) : 'no DID';
    chip.innerHTML = ''
      + (user.avatarUrl ? '<img class="user-avatar" src="' + escapeHtml(user.avatarUrl) + '" alt="">' : '')
      + '<div class="user-meta">'
      + '  <span class="user-name">' + escapeHtml(user.displayName || user.email) + '</span>'
      + '  <span class="user-did" title="' + escapeHtml(user.did || '') + '">' + escapeHtml(didShort) + '</span>'
      + '</div>'
      + '<button class="user-logout" id="hfLogoutBtn" title="Sign out">&#x21AA;</button>';
    headerRight.appendChild(chip);
    var btn = document.getElementById('hfLogoutBtn');
    if (btn) btn.addEventListener('click', function () {
      api('POST', '/auth/logout', {}).then(function () { window.location.reload(); });
    });
  }

  // ── Bootstrap ──────────────────────────────────────────────────────────
  function start() {
    api('GET', '/auth/me').then(function (user) {
      state.user = user;
      if (!user.onboarded) {
        if (window.HomeFlowOnboard) {
          window.HomeFlowOnboard.run(user, function (updatedUser) {
            state.user = updatedUser;
            renderUserChip(updatedUser);
            emitReady();
          });
        } else {
          renderLogin('Onboarding script missing. Please reload.');
        }
        return;
      }
      renderUserChip(user);
      emitReady();
    }).catch(function (err) {
      if (err.status === 401) {
        var params = new URLSearchParams(window.location.search);
        var failed = params.get('login') === 'failed';
        renderLogin(failed ? 'Sign in failed. Please try again.' : '');
      } else {
        renderLogin('Could not reach server: ' + err.message);
      }
    });
  }

  window.HomeFlowAuth = {
    onReady: onReady,
    user: function () { return state.user; },
    api: api
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start);
  } else {
    start();
  }
})();
