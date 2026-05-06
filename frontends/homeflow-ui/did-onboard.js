/* ============================================
   HomeFlow Family Pilot, DID Onboarding Wizard
   ============================================
   Generates an Ed25519 keypair via WebCrypto, derives the did:extropy DID
   string from the raw public key (matching packages/identity/src/did.ts),
   computes the multibase encoding, persists the private key in IndexedDB,
   and registers the DID with the server. The server issues a VC, anchors a
   Genesis vertex on the DAG, and stores the materials on the user row.

   Exposes window.HomeFlowOnboard.run(user, done).
*/

(function () {
  'use strict';

  var DB_NAME = 'homeflow-identity';
  var DB_STORE = 'keys';
  var KEY_PRIVATE = 'private';
  var KEY_PUBLIC = 'public';

  // ── IndexedDB helpers ──────────────────────────────────────────────────
  function openDb() {
    return new Promise(function (resolve, reject) {
      var req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = function () {
        req.result.createObjectStore(DB_STORE);
      };
      req.onsuccess = function () { resolve(req.result); };
      req.onerror = function () { reject(req.error); };
    });
  }

  function dbPut(key, value) {
    return openDb().then(function (db) {
      return new Promise(function (resolve, reject) {
        var tx = db.transaction(DB_STORE, 'readwrite');
        tx.objectStore(DB_STORE).put(value, key);
        tx.oncomplete = function () { resolve(); };
        tx.onerror = function () { reject(tx.error); };
      });
    });
  }

  function dbGet(key) {
    return openDb().then(function (db) {
      return new Promise(function (resolve, reject) {
        var tx = db.transaction(DB_STORE, 'readonly');
        var req = tx.objectStore(DB_STORE).get(key);
        req.onsuccess = function () { resolve(req.result); };
        req.onerror = function () { reject(req.error); };
      });
    });
  }

  // ── Encoding helpers ───────────────────────────────────────────────────
  function bytesToHex(bytes) {
    var hex = '';
    for (var i = 0; i < bytes.length; i++) {
      var h = bytes[i].toString(16);
      if (h.length === 1) h = '0' + h;
      hex += h;
    }
    return hex;
  }

  var BASE58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
  function base58btcEncode(bytes) {
    if (bytes.length === 0) return '';
    var n = 0n;
    for (var i = 0; i < bytes.length; i++) n = n * 256n + BigInt(bytes[i]);
    var out = '';
    while (n > 0n) {
      var r = Number(n % 58n);
      n = n / 58n;
      out = BASE58[r] + out;
    }
    for (var j = 0; j < bytes.length && bytes[j] === 0; j++) out = '1' + out;
    return out;
  }

  function publicKeyMultibase(pubBytes) {
    var prefixed = new Uint8Array(2 + pubBytes.length);
    prefixed[0] = 0xed;
    prefixed[1] = 0x01;
    prefixed.set(pubBytes, 2);
    return 'z' + base58btcEncode(prefixed);
  }

  // ── Key generation ─────────────────────────────────────────────────────
  function generateKeys() {
    if (!window.crypto || !window.crypto.subtle) {
      return Promise.reject(new Error('WebCrypto not available in this browser'));
    }
    return window.crypto.subtle.generateKey(
      { name: 'Ed25519' },
      true,
      ['sign', 'verify']
    ).then(function (kp) {
      return window.crypto.subtle.exportKey('raw', kp.publicKey).then(function (rawPub) {
        var pubBytes = new Uint8Array(rawPub);
        var pubHex = bytesToHex(pubBytes);
        var did = 'did:extropy:' + pubHex;
        var multibase = publicKeyMultibase(pubBytes);
        return {
          publicKey: kp.publicKey,
          privateKey: kp.privateKey,
          publicKeyBytes: pubBytes,
          publicKeyHex: pubHex,
          did: did,
          publicKeyMultibase: multibase
        };
      });
    });
  }

  // ── UI ─────────────────────────────────────────────────────────────────
  function render(user, content) {
    document.body.innerHTML = '';
    var wrap = document.createElement('div');
    wrap.className = 'auth-screen';
    wrap.innerHTML = ''
      + '<div class="auth-card auth-card-wide">'
      + '  <div class="auth-logo">&#9851; HomeFlow</div>'
      + '  <h1>Welcome ' + escapeHtml(user.displayName || user.email) + '</h1>'
      + '  <p class="auth-sub">Let\'s create your decentralized identity.</p>'
      + '  <div id="onboardContent">' + content + '</div>'
      + '</div>';
    document.body.appendChild(wrap);
  }

  function escapeHtml(str) {
    var div = document.createElement('div');
    div.textContent = String(str);
    return div.innerHTML;
  }

  function setContent(html) {
    var el = document.getElementById('onboardContent');
    if (el) el.innerHTML = html;
  }

  // ── Flow ───────────────────────────────────────────────────────────────
  function run(user, done) {
    render(user, ''
      + '<div class="onboard-step">'
      + '  <h2>Step 1. Generate your keypair</h2>'
      + '  <p>Your private key is generated here in your browser using WebCrypto, '
      + '  stored in IndexedDB, and never sent to the server. The server only sees '
      + '  your public key and the resulting did:extropy identifier.</p>'
      + '  <button id="onboardStartBtn" class="auth-google-btn">Generate keypair</button>'
      + '</div>'
    );
    var btn = document.getElementById('onboardStartBtn');
    btn.addEventListener('click', function () {
      btn.disabled = true;
      btn.textContent = 'Generating...';
      generateKeys().then(function (keys) {
        return Promise.all([
          dbPut(KEY_PRIVATE, keys.privateKey),
          dbPut(KEY_PUBLIC, { hex: keys.publicKeyHex, multibase: keys.publicKeyMultibase, did: keys.did })
        ]).then(function () { return keys; });
      }).then(function (keys) {
        setContent(''
          + '<div class="onboard-step">'
          + '  <h2>Step 2. Confirm your DID</h2>'
          + '  <p class="onboard-did-line"><strong>DID:</strong> <code>' + escapeHtml(keys.did) + '</code></p>'
          + '  <p class="onboard-did-line"><strong>Public key (multibase):</strong> <code>' + escapeHtml(keys.publicKeyMultibase) + '</code></p>'
          + '  <p>Click below to register this DID with the server. The server will issue you a Verifiable Credential and anchor a Genesis vertex on the DAG.</p>'
          + '  <button id="onboardRegisterBtn" class="auth-google-btn">Register DID and create Genesis vertex</button>'
          + '  <p class="auth-foot" id="onboardStatus"></p>'
          + '</div>'
        );
        document.getElementById('onboardRegisterBtn').addEventListener('click', function () {
          var rb = document.getElementById('onboardRegisterBtn');
          var status = document.getElementById('onboardStatus');
          rb.disabled = true;
          rb.textContent = 'Registering...';
          status.textContent = 'Calling /api/v1/identity/register ...';
          window.HomeFlowAuth.api('POST', '/api/v1/identity/register', {
            publicKeyHex: keys.publicKeyHex,
            publicKeyMultibase: keys.publicKeyMultibase,
            did: keys.did
          }).then(function (resp) {
            setContent(''
              + '<div class="onboard-step">'
              + '  <h2>You\'re in.</h2>'
              + '  <p class="onboard-did-line"><strong>DID:</strong> <code>' + escapeHtml(resp.did) + '</code></p>'
              + '  <p class="onboard-did-line"><strong>Genesis vertex:</strong> <code>' + escapeHtml(resp.genesisVertexId) + '</code></p>'
              + '  <p>Each action you take in HomeFlow will now be signed into your personal PSLL with this key.</p>'
              + '  <button id="onboardEnterBtn" class="auth-google-btn">Enter HomeFlow</button>'
              + '</div>'
            );
            document.getElementById('onboardEnterBtn').addEventListener('click', function () {
              var updated = Object.assign({}, user, {
                did: resp.did,
                publicKeyMultibase: resp.publicKeyMultibase,
                genesisVertexId: resp.genesisVertexId,
                onboarded: true
              });
              window.location.reload();
              done(updated);
            });
          }).catch(function (err) {
            rb.disabled = false;
            rb.textContent = 'Try again';
            status.textContent = 'Registration failed: ' + (err.message || err);
          });
        });
      }).catch(function (err) {
        setContent('<div class="onboard-step"><h2>Could not generate keypair</h2><p>' + escapeHtml(err.message || String(err)) + '</p></div>');
      });
    });
  }

  function loadKeys() {
    return Promise.all([dbGet(KEY_PRIVATE), dbGet(KEY_PUBLIC)]).then(function (rows) {
      return { privateKey: rows[0], pub: rows[1] };
    });
  }

  window.HomeFlowOnboard = { run: run, loadKeys: loadKeys };
})();
