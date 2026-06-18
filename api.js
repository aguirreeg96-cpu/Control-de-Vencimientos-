/* ============================================================
   LOGICONTROL PRO — api.js
   HTTP transport + token management
   ============================================================ */

if (!window.APP_CONFIG || !window.APP_CONFIG.API_BASE_URL) {
  throw new Error('[LOGICONTROL PRO] config.js no cargado — falta APP_CONFIG.API_BASE_URL');
}
var API_BASE = window.APP_CONFIG.API_BASE_URL;

// ─── TOKEN STORE ─────────────────────────────────────────────
// accessToken: sessionStorage (cleared on tab close)
// refreshToken: localStorage (persists across sessions — temporary approach)
var TokenStore = {
  getAccess:  function() { return sessionStorage.getItem('lcp3_at'); },
  setAccess:  function(t) { sessionStorage.setItem('lcp3_at', t); },
  getRefresh: function() { return localStorage.getItem('lcp3_rt'); },
  setRefresh: function(t) { localStorage.setItem('lcp3_rt', t); },
  clear: function() {
    sessionStorage.removeItem('lcp3_at');
    localStorage.removeItem('lcp3_rt');
  }
};

// ─── USER STORE ──────────────────────────────────────────────
var UserStore = {
  get: function() {
    try {
      var u = sessionStorage.getItem('lcp3_user');
      return u ? JSON.parse(u) : null;
    } catch(e) { return null; }
  },
  set: function(u) { sessionStorage.setItem('lcp3_user', JSON.stringify(u)); },
  clear: function() { sessionStorage.removeItem('lcp3_user'); }
};

// ─── SESSION EXPIRED CALLBACK ────────────────────────────────
var _onSessionExpiredFn = null;
function onSessionExpiredCallback(fn) { _onSessionExpiredFn = fn; }

// ─── TOKEN REFRESH ───────────────────────────────────────────
var _isRefreshing = false;

function tryRefresh() {
  var rt = TokenStore.getRefresh();
  if (!rt) return Promise.reject(new Error('no_refresh_token'));
  return fetch(API_BASE + '/auth/refresh', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ refreshToken: rt })
  })
  .then(function(res) {
    if (!res.ok) {
      TokenStore.clear();
      UserStore.clear();
      throw new Error('refresh_failed');
    }
    return res.json();
  })
  .then(function(data) {
    TokenStore.setAccess(data.accessToken);
    TokenStore.setRefresh(data.refreshToken);
    return data.accessToken;
  });
}

// ─── CORE FETCH ──────────────────────────────────────────────
function apiFetch(path, opts) {
  opts = opts || {};
  var headers = {};
  if (!opts._rawBody) headers['Content-Type'] = 'application/json';
  var at = TokenStore.getAccess();
  if (at) headers['Authorization'] = 'Bearer ' + at;
  Object.assign(headers, opts.headers || {});

  var reqOpts = Object.assign({}, opts, { headers: headers });
  delete reqOpts._rawBody;

  return fetch(API_BASE + path, reqOpts)
  .then(function(res) {
    if (res.status === 401 && !opts._retry) {
      if (_isRefreshing) return Promise.reject(new Error('already_refreshing'));
      _isRefreshing = true;
      return tryRefresh()
      .then(function(newToken) {
        _isRefreshing = false;
        headers['Authorization'] = 'Bearer ' + newToken;
        return fetch(API_BASE + path, Object.assign({}, reqOpts, { headers: headers, _retry: true }));
      })
      .catch(function(err) {
        _isRefreshing = false;
        if (_onSessionExpiredFn) _onSessionExpiredFn();
        throw err;
      });
    }
    return res;
  });
}

// ─── JSON HELPER ─────────────────────────────────────────────
function apiJson(path, opts) {
  return apiFetch(path, opts).then(function(res) {
    if (!res.ok) {
      return res.json().catch(function() { return {}; }).then(function(body) {
        var msg = body.message;
        if (Array.isArray(msg)) msg = msg.join('; ');
        var err = new Error(msg || ('Error ' + res.status));
        err.status = res.status;
        err.body = body;
        throw err;
      });
    }
    return res.json();
  });
}
