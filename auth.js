/* ============================================================
   LOGICONTROL PRO — auth.js
   Session management + login UI
   Depends on: api.js (TokenStore, UserStore, apiJson, tryRefresh, onSessionExpiredCallback)
   ============================================================ */

// ─── LOGIN OVERLAY ───────────────────────────────────────────
function showLoginOverlay() {
  var el = document.getElementById('login-overlay');
  if (el) el.style.display = 'flex';
  var app = document.getElementById('app');
  if (app) app.style.display = 'none';
}

function hideLoginOverlay() {
  var el = document.getElementById('login-overlay');
  if (el) el.style.display = 'none';
  var app = document.getElementById('app');
  if (app) app.style.display = '';
}

// ─── USER INFO ───────────────────────────────────────────────
function updateUserInfo(user) {
  if (!user) return;
  var roleLabels = { SUPER_ADMIN: 'Super Admin', COMPANY_ADMIN: 'Administrador', USER: 'Usuario' };
  var avatarEl = document.getElementById('user-avatar');
  var nameEl   = document.getElementById('user-name');
  var roleEl   = document.getElementById('user-role');
  var initial  = (user.name || user.email || 'U')[0].toUpperCase();
  if (avatarEl) avatarEl.textContent = initial;
  if (nameEl)   nameEl.textContent   = user.name || user.email || 'Usuario';
  if (roleEl)   roleEl.textContent   = roleLabels[user.role] || 'Usuario';
}

function isAdmin() {
  var user = UserStore.get();
  return user && (user.role === 'SUPER_ADMIN' || user.role === 'COMPANY_ADMIN');
}

// ─── LOGIN ───────────────────────────────────────────────────
function handleLogin(email, password) {
  return fetch(API_BASE + '/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: email, password: password })
  })
  .then(function(res) {
    if (!res.ok) {
      return res.json().catch(function() { return {}; }).then(function(body) {
        var msg = body.message;
        if (Array.isArray(msg)) msg = msg.join('; ');
        throw new Error(msg || 'Credenciales inválidas');
      });
    }
    return res.json();
  })
  .then(function(data) {
    TokenStore.setAccess(data.accessToken);
    TokenStore.setRefresh(data.refreshToken);
    return apiJson('/auth/me');
  })
  .then(function(user) {
    UserStore.set(user);
    updateUserInfo(user);
    hideLoginOverlay();
    return user;
  });
}

// ─── LOGOUT ──────────────────────────────────────────────────
function handleLogout() {
  var at = TokenStore.getAccess();
  if (at) {
    fetch(API_BASE + '/auth/logout', {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + at, 'Content-Type': 'application/json' }
    }).catch(function() {});
  }
  TokenStore.clear();
  UserStore.clear();
  showLoginOverlay();
}

// ─── CHECK SESSION ───────────────────────────────────────────
function checkSession() {
  var at   = TokenStore.getAccess();
  var user = UserStore.get();

  if (at && user) {
    updateUserInfo(user);
    hideLoginOverlay();
    return Promise.resolve(user);
  }

  var rt = TokenStore.getRefresh();
  if (!rt) {
    showLoginOverlay();
    return Promise.resolve(null);
  }

  return tryRefresh()
  .then(function() { return apiJson('/auth/me'); })
  .then(function(user) {
    UserStore.set(user);
    updateUserInfo(user);
    hideLoginOverlay();
    return user;
  })
  .catch(function() {
    TokenStore.clear();
    UserStore.clear();
    showLoginOverlay();
    return null;
  });
}

// ─── LOGIN FORM ──────────────────────────────────────────────
function initLoginForm() {
  var form  = document.getElementById('login-form');
  var errEl = document.getElementById('login-error');
  if (!form) return;

  form.addEventListener('submit', function(e) {
    e.preventDefault();
    var email = (document.getElementById('login-email').value || '').trim();
    var pwd   = document.getElementById('login-password').value;
    if (!email || !pwd) return;

    var btn = form.querySelector('button[type="submit"]');
    if (btn) btn.disabled = true;
    if (errEl) errEl.textContent = '';

    handleLogin(email, pwd)
    .then(function() {
      if (typeof loadApiData === 'function') {
        return loadApiData().then(function() { navigate('dashboard'); });
      }
      navigate('dashboard');
    })
    .catch(function(err) {
      if (errEl) errEl.textContent = err.message || 'Error al iniciar sesión';
    })
    .finally(function() {
      if (btn) btn.disabled = false;
    });
  });
}

// ─── SESSION EXPIRED HOOK ────────────────────────────────────
onSessionExpiredCallback(function() {
  TokenStore.clear();
  UserStore.clear();
  showLoginOverlay();
  if (typeof toast === 'function') toast('Sesión expirada. Iniciá sesión nuevamente.', 'error');
});
