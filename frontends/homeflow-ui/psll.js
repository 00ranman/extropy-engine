/* ============================================
   HomeFlow Family Pilot, Per User Signed Local Log
   ============================================
   Wraps user actions so each one is canonicalized, signed with the local
   Ed25519 key from IndexedDB, and posted to /api/v1/psll/append. Also
   provides a small helper to fetch and render the user's recent entries.
   Exposes window.HomeFlowPSLL.
*/

(function () {
  'use strict';

  function bytesToB64u(bytes) {
    var bin = '';
    for (var i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }

  function getPrivateKey() {
    return window.HomeFlowOnboard.loadKeys().then(function (keys) {
      if (!keys.privateKey) throw new Error('local private key missing, please re-onboard');
      return keys.privateKey;
    });
  }

  function fetchHead() {
    return window.HomeFlowAuth.api('GET', '/api/v1/psll/head');
  }

  function buildSigningInput(payload) {
    return JSON.stringify({
      entry: payload.entry,
      prevHash: payload.prevHash,
      seq: payload.seq,
      ts: payload.ts
    });
  }

  function appendEntry(entry) {
    return Promise.all([getPrivateKey(), fetchHead()]).then(function (rows) {
      var privateKey = rows[0];
      var head = rows[1];
      var seq = (head.seq || 0) + 1;
      var prevHash = head.hash || ('0'.repeat(64));
      var ts = Date.now();
      var signingInput = buildSigningInput({ entry: entry, prevHash: prevHash, seq: seq, ts: ts });
      var bytes = new TextEncoder().encode(signingInput);
      return window.crypto.subtle.sign({ name: 'Ed25519' }, privateKey, bytes).then(function (sig) {
        var signature = bytesToB64u(new Uint8Array(sig));
        return window.HomeFlowAuth.api('POST', '/api/v1/psll/append', {
          entry: entry,
          signature: signature,
          prevHash: prevHash,
          seq: seq,
          ts: ts
        });
      });
    });
  }

  function listMine(since) {
    var q = since ? ('?since=' + encodeURIComponent(since)) : '';
    return window.HomeFlowAuth.api('GET', '/api/v1/psll/me' + q);
  }

  window.HomeFlowPSLL = {
    appendEntry: appendEntry,
    listMine: listMine
  };
})();
