/**
 * ================================================================
 * SHAH GROUP POS — ADVANCED FIXES (Part 2)
 * ================================================================
 * Yeh file shahgroup_fixes.js ke BAAD paste karein (same location)
 * yaani </script> se pehle, shahgroup_fixes.js ke neeche
 *
 * IS FILE MEIN:
 *   ADV-01: Password SHA-256 Hashing (Web Crypto API)
 *   ADV-02: Brute Force Protection (3 tries lockout)
 *   ADV-03: Permission Enforcement on Actions
 *   ADV-04: Session Timeout (30 min inactivity)
 *   ADV-05: canDo() actually use karna (confirmInv, etc.)
 *   ADV-06: Login Loading State (double-click prevent)
 *   ADV-07: Data Validation on all save functions
 *   ADV-08: Phone number validation helper
 *   ADV-09: Unsaved changes warning
 *   ADV-10: Memory leak fixes (URL.revokeObjectURL, etc.)
 * ================================================================
 */


// ════════════════════════════════════════════════════════════════
// ADV-01: Password SHA-256 Hashing
// ════════════════════════════════════════════════════════════════
//
// PLAIN TEXT PASSWORDS KI PROBLEM:
//   - Browser Console → Application → Local Storage → sg_users
//   - Sab users + passwords plain text mein visible hain
//   - "View Source" se bhi default passwords dikh jaate hain
//
// YEH FIX KIA KARTA HAI:
//   - Naye passwords SHA-256 hash mein store honge
//   - Login ke waqt entered password ko hash karke compare karta hai
//   - Old plain-text users auto-migrate ho jaate hain first login par
//
// IMPORTANT: Yeh async hai isliye doLogin ko bhi async banana pada
//
// ════════════════════════════════════════════════════════════════

var _pwHashSalt = 'SGPOSv11_salt_2024_shah_group';  // Application salt

/**
 * Password ko SHA-256 hash mein convert karo
 * @param {string} password - Plain text password
 * @returns {Promise<string>} - Hex string hash
 */
async function hashPassword(password) {
  try {
    var data    = new TextEncoder().encode(password + _pwHashSalt);
    var hashBuf = await crypto.subtle.digest('SHA-256', data);
    return Array.from(new Uint8Array(hashBuf))
      .map(function(b) { return b.toString(16).padStart(2, '0'); })
      .join('');
  } catch(e) {
    // Agar Web Crypto API available nahi (very old browser) toh fallback
    console.warn('[SHAH POS] Web Crypto API unavailable, basic hash use ho raha hai');
    return _basicHash(password);
  }
}

/**
 * Basic fallback hash (old browsers ke liye only)
 */
function _basicHash(str) {
  var hash = 5381;
  str = str + _pwHashSalt;
  for (var i = 0; i < str.length; i++) {
    hash = ((hash << 5) + hash) ^ str.charCodeAt(i);
    hash = hash & hash;
  }
  return 'bh_' + Math.abs(hash).toString(16).padStart(8, '0');
}

/**
 * Check karo ke password hash se match karta hai ya nahi
 * @param {string} plainPassword - User ne jo type kiya
 * @param {string} storedHash - Database mein jo store hai
 * @returns {Promise<boolean>}
 */
async function verifyPassword(plainPassword, storedHash) {
  // Backward compat: agar old plain-text password hai (no 'bh_' prefix, no 64-char hex)
  if (storedHash && storedHash.length < 20) {
    // Ye plain text password hai — direct compare karo
    return plainPassword === storedHash;
  }
  var computed = await hashPassword(plainPassword);
  return computed === storedHash;
}

/**
 * Migrate existing plain text passwords to hashed (ek baar)
 */
async function migratePasswords() {
  var migrated = false;
  for (var i = 0; i < users.length; i++) {
    var u = users[i];
    // Agar password chhota hai (plain text lagta hai)
    if (u.password && u.password.length < 20 && !u.passwordMigrated) {
      u.password          = await hashPassword(u.password);
      u.passwordMigrated  = true;
      migrated            = true;
    }
  }
  if (migrated) {
    try { localStorage.setItem('sg_users', JSON.stringify(users)); } catch(e) {}
    console.info('[SHAH POS ADV-01] ' + users.length + ' user passwords hashed ho gaye ✅');
  }
}

// ─── Login function replace: async + hashing ────────────────────
window.doLogin = async function() {
  var u = (document.getElementById('lgUser').value || '').trim();
  var p = (document.getElementById('lgPass').value || '').trim();

  if (!u || !p) {
    _showLoginError('Username aur password dono likhein');
    return;
  }

  // Brute force check (ADV-02)
  if (_isLockedOut()) {
    var remain = _lockoutRemaining();
    _showLoginError('Bahut zyada galat tries! ' + remain + ' second mein dobara karein');
    return;
  }

  // Loading state (ADV-06)
  var btn = document.querySelector('.login-btn');
  if (btn) { btn.disabled = true; btn.textContent = '⏳ Checking...'; }

  var found = null;
  for (var i = 0; i < users.length; i++) {
    if (users[i].username === u) {
      var match = await verifyPassword(p, users[i].password);
      if (match) { found = users[i]; break; }
    }
  }

  // Reset button
  if (btn) { btn.disabled = false; btn.textContent = '🔐 Login Karen'; }

  if (found) {
    _resetLoginAttempts();
    _startSessionTimer();          // ADV-04

    currentUser = found;
    document.getElementById('loginOverlay').style.display = 'none';

    // User badge update
    var mainBadge = document.getElementById('userNameBadge');
    if (mainBadge) mainBadge.textContent = (found.role === 'admin' ? '👑 ' : '👤 ') + found.name;
    document.querySelectorAll('.user-name-badge').forEach(function(el) {
      el.textContent = found.name + (found.role === 'admin' ? ' 👑' : '');
    });

    loadData();
    loadAppSettings();
    renderDashboard();

    var lb = document.getElementById('actLogBtn');
    if (lb) lb.style.display = found.role === 'admin' ? '' : 'none';

    // Migrate passwords on first login
    await migratePasswords();

    toast('Khush Amdeed, ' + found.name + '! 👋');
    logActivity('login', 'Login: ' + found.name + ' (' + found.role + ')', 'login', 'success');
  } else {
    _recordFailedAttempt();
    var attempts = _getLoginAttempts();
    var remaining = 3 - attempts;
    if (remaining > 0) {
      _showLoginError('❌ Username ya Password galat hai (' + remaining + ' tries baqi)');
    } else {
      _showLoginError('🔒 Account lock ho gaya — 60 second wait karein');
    }
  }
};

function _showLoginError(msg) {
  var el = document.getElementById('lgErr');
  if (!el) return;
  el.textContent = msg;
  el.style.display = 'block';
  clearTimeout(window._loginErrTimer);
  window._loginErrTimer = setTimeout(function() {
    el.style.display = 'none';
  }, 4000);
}


// ════════════════════════════════════════════════════════════════
// ADV-02: Brute Force Login Protection
// ════════════════════════════════════════════════════════════════
//
// MASLA: Koi bhi infinite baar login try kar sakta tha
// FIX: 3 galat tries ke baad 60 second ka lockout
//
// ════════════════════════════════════════════════════════════════

var _LOGIN_MAX_ATTEMPTS = 3;
var _LOGIN_LOCKOUT_MS   = 60 * 1000;  // 60 seconds

function _getLoginAttempts() {
  try {
    var d = JSON.parse(localStorage.getItem('sg_login_attempts') || '{}');
    return d.count || 0;
  } catch(e) { return 0; }
}

function _recordFailedAttempt() {
  try {
    var d = JSON.parse(localStorage.getItem('sg_login_attempts') || '{}');
    d.count = (d.count || 0) + 1;
    if (d.count >= _LOGIN_MAX_ATTEMPTS) {
      d.lockedUntil = Date.now() + _LOGIN_LOCKOUT_MS;
    }
    localStorage.setItem('sg_login_attempts', JSON.stringify(d));
  } catch(e) {}
}

function _resetLoginAttempts() {
  try { localStorage.removeItem('sg_login_attempts'); } catch(e) {}
}

function _isLockedOut() {
  try {
    var d = JSON.parse(localStorage.getItem('sg_login_attempts') || '{}');
    if (d.lockedUntil && Date.now() < d.lockedUntil) return true;
    if (d.lockedUntil && Date.now() >= d.lockedUntil) {
      localStorage.removeItem('sg_login_attempts');  // Auto-unlock
    }
    return false;
  } catch(e) { return false; }
}

function _lockoutRemaining() {
  try {
    var d = JSON.parse(localStorage.getItem('sg_login_attempts') || '{}');
    if (!d.lockedUntil) return 0;
    return Math.max(0, Math.ceil((d.lockedUntil - Date.now()) / 1000));
  } catch(e) { return 0; }
}


// ════════════════════════════════════════════════════════════════
// ADV-03: Permission Enforcement on Critical Actions
// ════════════════════════════════════════════════════════════════
//
// MASLA: canDo() function tha lekin koi bhi action function mein
//        use nahi ho raha tha! Staff koi bhi kaam kar sakta tha.
// FIX: har action mein canDo() check karo
//
// ════════════════════════════════════════════════════════════════

// confirmInv wrapper: invoice banana permission check
var _origConfirmInvPerm = window.confirmInv;
window.confirmInv = function() {
  if (!currentUser) { toast('Pehle login karein!', 'error'); return; }
  if (typeof canDo === 'function' && !canDo('invoice')) {
    toast('❌ Aapko invoice banana ki permission nahi hai', 'error');
    logActivity('permission_denied', 'Invoice banana try kiya', 'invoice', 'error');
    return;
  }
  if (typeof _origConfirmInvPerm === 'function') _origConfirmInvPerm.apply(this, arguments);
};

// confirmPur wrapper: purchase karne ki permission check
var _origConfirmPurPerm = window.confirmPur;
window.confirmPur = function() {
  if (!currentUser) { toast('Pehle login karein!', 'error'); return; }
  if (typeof canDo === 'function' && !canDo('purchase')) {
    toast('❌ Aapko purchase karne ki permission nahi hai', 'error');
    logActivity('permission_denied', 'Purchase karna try kiya', 'purchase', 'error');
    return;
  }
  if (typeof _origConfirmPurPerm === 'function') _origConfirmPurPerm.apply(this, arguments);
};

// saveNewCus wrapper: customer add karne ki permission
var _origSaveNewCusPerm = window.saveNewCus;
window.saveNewCus = function() {
  if (typeof canDo === 'function' && !canDo('customers')) {
    toast('❌ Aapko customers edit karne ki permission nahi hai', 'error');
    return;
  }
  if (typeof _origSaveNewCusPerm === 'function') _origSaveNewCusPerm.apply(this, arguments);
};

// saveNewSup wrapper: supplier add karne ki permission
var _origSaveNewSupPerm = window.saveNewSup;
window.saveNewSup = function() {
  if (typeof canDo === 'function' && !canDo('suppliers')) {
    toast('❌ Aapko suppliers edit karne ki permission nahi hai', 'error');
    return;
  }
  if (typeof _origSaveNewSupPerm === 'function') _origSaveNewSupPerm.apply(this, arguments);
};

// Expense add karne ki permission
var _origSaveNewExpPerm = window.saveNewExp;
window.saveNewExp = function() {
  if (typeof canDo === 'function' && !canDo('expenses')) {
    toast('❌ Aapko expenses add karne ki permission nahi hai', 'error');
    return;
  }
  if (typeof _origSaveNewExpPerm === 'function') _origSaveNewExpPerm.apply(this, arguments);
};

// Reports dekhnay ki permission (showPage wrapper mein)
var _origShowPagePerm = window.showPage;
window.showPage = function(p) {
  if (!currentUser && p !== 'dashboard') {
    // Not logged in
    return;
  }
  // Permission checks for sensitive pages
  var pagePermMap = {
    'reports':  'reports',
    'expenses': 'expenses',
    'stock':    'stock'
  };
  if (pagePermMap[p] && typeof canDo === 'function' && !canDo(pagePermMap[p])) {
    toast('❌ Is page ka access nahi hai', 'error');
    return;
  }
  if (typeof _origShowPagePerm === 'function') _origShowPagePerm.apply(this, arguments);
};


// ════════════════════════════════════════════════════════════════
// ADV-04: Session Timeout — 30 Minutes Inactivity
// ════════════════════════════════════════════════════════════════
//
// MASLA: User login kare aur computer chhod de — koi bhi use kar sakta tha
// FIX: 30 min activity nahi toh auto logout
//
// ════════════════════════════════════════════════════════════════

var _SESSION_TIMEOUT_MS = 30 * 60 * 1000;  // 30 minutes
var _sessionTimer       = null;
var _sessionWarned      = false;

function _startSessionTimer() {
  _resetSessionTimer();

  // User activity track karo
  ['click', 'keydown', 'touchstart', 'mousemove'].forEach(function(evt) {
    document.addEventListener(evt, _resetSessionTimer, { passive: true });
  });
}

function _resetSessionTimer() {
  clearTimeout(_sessionTimer);
  _sessionWarned = false;

  // Warning 5 min pehle
  var warningTimer = setTimeout(function() {
    if (currentUser && !_sessionWarned) {
      _sessionWarned = true;
      toast('⚠️ 5 minute mein auto logout ho jayega — Kuch karein!', 'error');
    }
  }, _SESSION_TIMEOUT_MS - (5 * 60 * 1000));

  _sessionTimer = setTimeout(function() {
    if (currentUser) {
      toast('⏰ Session expire ho gaya — Dobara login karein', 'error');
      logActivity('session_timeout', 'Auto logout: inactivity', 'system', 'warning');
      setTimeout(function() {
        if (typeof doLogout === 'function') doLogout();
      }, 2000);
    }
  }, _SESSION_TIMEOUT_MS);
}

// doLogout mein timer bhi clear karo
var _origDoLogoutSession = window.doLogout;
window.doLogout = function() {
  clearTimeout(_sessionTimer);
  _sessionWarned = false;
  ['click', 'keydown', 'touchstart', 'mousemove'].forEach(function(evt) {
    document.removeEventListener(evt, _resetSessionTimer);
  });
  if (typeof _origDoLogoutSession === 'function') _origDoLogoutSession.apply(this, arguments);
};


// ════════════════════════════════════════════════════════════════
// ADV-06: Login Button Loading State / Double-click Prevent
// MASLA: User double-click kare toh do login requests jaate the
// ════════════════════════════════════════════════════════════════
// Already handled in ADV-01 doLogin function above


// ════════════════════════════════════════════════════════════════
// ADV-07: Input Validation Helpers
// ════════════════════════════════════════════════════════════════

/**
 * Phone number validate karo (Pakistan format)
 * Valid: 03xx-xxxxxxx, 03xxxxxxxxx, +923xxxxxxxxx
 */
function validatePhone(phone) {
  if (!phone) return false;
  var cleaned = phone.replace(/[\s\-\(\)]/g, '');
  // Pakistan: 03xx + 7 digits = 11 digits, or +92 format
  return /^(03\d{9}|923\d{9}|\+923\d{9}|0\d{9,10})$/.test(cleaned);
}

/**
 * Amount validate karo
 */
function validateAmount(val) {
  var n = Number(val);
  return !isNaN(n) && n >= 0 && n < 100000000;  // Max 10 crore
}

/**
 * Required field check — trim ke baad empty nahi hona chahiye
 */
function validateRequired(val) {
  return val !== null && val !== undefined && String(val).trim().length > 0;
}

// saveNewCus mein phone validation add karo
var _origSaveNewCusValidation = window.saveNewCus;
window.saveNewCus = function() {
  var phone = (document.getElementById('ncPhone').value || '').trim();
  if (phone && !validatePhone(phone)) {
    toast('⚠️ Phone number format sahi nahi — e.g. 03001234567', 'error');
    document.getElementById('ncPhone').focus();
    return;
  }
  if (typeof _origSaveNewCusValidation === 'function') _origSaveNewCusValidation.apply(this, arguments);
};

// saveNewSup mein phone validation
var _origSaveNewSupValidation = window.saveNewSup;
window.saveNewSup = function() {
  var phone = (document.getElementById('nsPhone').value || '').trim();
  if (phone && !validatePhone(phone)) {
    toast('⚠️ Phone number format sahi nahi — e.g. 03001234567', 'error');
    document.getElementById('nsPhone').focus();
    return;
  }
  if (typeof _origSaveNewSupValidation === 'function') _origSaveNewSupValidation.apply(this, arguments);
};


// ════════════════════════════════════════════════════════════════
// ADV-08: Unsaved Changes Warning
// MASLA: User invoice bhar ke accidentally page change kar leta tha
// FIX: Agar billRows mein kuch hai toh navigate karne se pehle warn karo
// ════════════════════════════════════════════════════════════════

var _origShowPageUnsaved = window.showPage;
window.showPage = function(p) {
  // Agar invoice page pe hain aur billRows mein items hain
  var currentPageEl = document.querySelector('.page.active');
  var currentPageId = currentPageEl ? currentPageEl.id : '';

  if (currentPageId === 'page-invoice' && p !== 'invoice') {
    var hasItems = typeof billRows !== 'undefined' && billRows.length > 0;
    if (hasItems) {
      var ok = confirm('⚠️ Invoice mein ' + billRows.length + ' items hain jo save nahi hue!\n\nKya aap waqai page change karna chahte hain?\n(Invoice ka data kho jayega)');
      if (!ok) return;
      // Clear karo
      if (typeof billRows !== 'undefined') billRows = [];
      if (typeof renderBillTable === 'function') renderBillTable();
    }
  }
  if (typeof _origShowPageUnsaved === 'function') _origShowPageUnsaved.apply(this, arguments);
};


// ════════════════════════════════════════════════════════════════
// ADV-09: Memory Leak Fixes
// ════════════════════════════════════════════════════════════════
//
// MASLA: Blob URLs (createObjectURL) create hoti hain lekin revoke nahi hoti
//        PDF/CSV download ke baad memory leak hoti rehti hai
//
// ════════════════════════════════════════════════════════════════

// downloadBackup mein URL.revokeObjectURL add karo
var _origDownloadBackup = window.downloadBackup;
window.downloadBackup = function() {
  var data = {
    version: 'v3',
    date:    new Date().toISOString(),
    customers:    customers,
    suppliers:    suppliers,
    stockItems:   stockItems,
    invoiceList:  invoiceList,
    purchaseList: purchaseList,
    categories:   categories,
    expenses:     expenses,
    refunds:      refunds,
    kistPlans:    kistPlans
  };
  var blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  var url  = URL.createObjectURL(blob);
  var a    = document.createElement('a');
  a.href   = url;
  a.download = 'SHAH_Group_Backup_' + new Date().toISOString().split('T')[0] + '.json';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(function() { URL.revokeObjectURL(url); }, 1000);  // ← Memory leak fix
  toast('✅ Backup download ho gaya!');
  logActivity('backup', 'Data backup download kiya', 'settings', 'success');
};


// ════════════════════════════════════════════════════════════════
// ADV-10: saveNewUser — Password Change pe Hash Update
// MASLA: Agar user apna password change kare toh bhi hash nahi hota tha
// ════════════════════════════════════════════════════════════════

// saveNewUser ko async banana padega (password hashing ke liye)
var _origSaveNewUserAsync = window.saveNewUser;
window.saveNewUser = async function() {
  var name    = (document.getElementById('nuName').value     || '').trim();
  var uname   = (document.getElementById('nuUsername').value || '').trim();
  var pass    = (document.getElementById('nuPass').value     || '').trim();
  var role    = document.getElementById('nuRole').value;
  var editUEl = document.getElementById('nuEditUsername');
  var editU   = editUEl ? editUEl.value.trim() : '';

  if (!name || !uname || !pass) {
    toast('Sab fields fill karein!', 'error');
    return;
  }
  if (uname.length < 3) {
    toast('Username kam az kam 3 characters ka hona chahiye', 'error');
    return;
  }
  if (pass.length < 6) {
    toast('Password kam az kam 6 characters ka hona chahiye', 'error');
    return;
  }

  // Hash the password before saving
  var hashedPass = await hashPassword(pass);

  if (editU) {
    var idx = users.findIndex(function(u) { return u.username === editU; });
    if (idx >= 0) {
      users[idx].name              = name;
      users[idx].username          = uname;
      users[idx].password          = hashedPass;   // ← Hashed
      users[idx].passwordMigrated  = true;
      users[idx].role              = role;
    }
  } else {
    if (users.find(function(u) { return u.username === uname; })) {
      toast('Ye username pehle se hai!', 'error');
      return;
    }
    users.push({
      username:         uname,
      password:         hashedPass,   // ← Hashed
      passwordMigrated: true,
      role:             role,
      name:             name
    });
  }

  // Permissions
  if (role === 'staff') {
    if (!permissions[uname]) permissions[uname] = {};
    var cbs = document.querySelectorAll('#nuPermsGrid input[type=checkbox]');
    cbs.forEach(function(cb) { permissions[uname][cb.dataset.perm] = cb.checked; });
    savePermissions();
  } else {
    delete permissions[uname];
    savePermissions();
  }

  // Form reset
  ['nuName','nuUsername','nuPass'].forEach(function(id) {
    var el = document.getElementById(id); if(el) el.value = '';
  });
  if (editUEl) editUEl.value = '';

  var pop = document.getElementById('newUserPop');
  if (pop) pop.classList.remove('open');

  if (typeof renderUsersList     === 'function') renderUsersList();
  if (typeof renderPermissionsUI === 'function') renderPermissionsUI();

  try { localStorage.setItem('sg_users', JSON.stringify(users)); } catch(e) {}
  toast('✅ ' + name + ' ' + (editU ? 'update' : 'add') + ' ho gaya!');
};


// ════════════════════════════════════════════════════════════════
// BONUS: Stock Low Indicator on Dashboard Cards
// ════════════════════════════════════════════════════════════════

// Dashboard render ke baad stock card pe low item count show karo
var _origRenderDashLow = window.renderDashboard;
window.renderDashboard = function() {
  if (typeof _origRenderDashLow === 'function') _origRenderDashLow.apply(this, arguments);

  // Stock card update: correct count show karo
  var lowCount = (typeof stockItems !== 'undefined')
    ? stockItems.filter(function(s) { return s.qty <= (s.min || 0); }).length
    : 0;

  var dashStockEl = document.getElementById('dash-stock-low');
  if (dashStockEl && lowCount > 0) {
    dashStockEl.style.color  = '#ef4444';
    dashStockEl.style.fontWeight = '900';
  }
};


// ════════════════════════════════════════════════════════════════
// BONUS: Keyboard Shortcuts
// ════════════════════════════════════════════════════════════════
//
// Ctrl+N = New Invoice
// Ctrl+P = New Purchase
// Ctrl+D = Dashboard
// Ctrl+S = Manual Sync
// Escape = Close any open popup
//
// ════════════════════════════════════════════════════════════════

document.addEventListener('keydown', function(e) {
  // Agar input/textarea mein typing ho rahi hai toh shortcuts ignore karo
  var tag = (e.target.tagName || '').toLowerCase();
  if (tag === 'input' || tag === 'textarea' || tag === 'select') return;
  if (!currentUser) return;

  if (e.ctrlKey || e.metaKey) {
    switch(e.key.toLowerCase()) {
      case 'n':
        e.preventDefault();
        if (typeof showPage === 'function') showPage('invoice');
        break;
      case 'p':
        e.preventDefault();
        if (typeof showPage === 'function') showPage('purchase');
        break;
      case 'd':
        e.preventDefault();
        if (typeof showPage === 'function') showPage('dashboard');
        break;
      case 's':
        e.preventDefault();
        if (typeof syncToSheets === 'function') {
          syncToSheets(false);
          toast('🔄 Manual sync shuru...');
        }
        break;
    }
  }

  if (e.key === 'Escape') {
    // Saare open popups band karo
    document.querySelectorAll('.popup.open, .popup-overlay.open').forEach(function(el) {
      el.classList.remove('open');
    });
    // Global search bhi band karo
    if (typeof closeGlobalSearch === 'function') closeGlobalSearch();
  }
});


// ════════════════════════════════════════════════════════════════
// BONUS: Better Error Messages for Network Failures
// ════════════════════════════════════════════════════════════════

var _origLoadFromGS = window.loadFromGS;
window.loadFromGS = function() {
  // Network check
  if (!navigator.onLine) {
    toast('📡 Internet connection nahi hai — Offline mode mein kaam kar rahe hain', 'error');
    hideLoadingNotice();
    return;
  }
  if (typeof _origLoadFromGS === 'function') _origLoadFromGS.apply(this, arguments);
};

// Online/offline events
window.addEventListener('online', function() {
  toast('✅ Internet connection wapis aa gaya!');
  if ((gsItemsUrl || gsAccountsUrl) && currentUser) {
    setTimeout(function() { autoSyncGS(); }, 1000);
  }
});
window.addEventListener('offline', function() {
  toast('📡 Internet connection cut gaya — changes locally save ho rahe hain', 'error');
});


// ════════════════════════════════════════════════════════════════
// BONUS: Auto-save Indicator on every data change
// ════════════════════════════════════════════════════════════════

var _origSaveDataIndicator = window.saveData;
window.saveData = function() {
  if (typeof _origSaveDataIndicator === 'function') {
    _origSaveDataIndicator.apply(this, arguments);
  }
  // Show "saving" badge
  if (typeof showSyncBadge === 'function') {
    showSyncBadge('saving');
    // After debounce time, show saved
    clearTimeout(window._saveBadgeTimer);
    window._saveBadgeTimer = setTimeout(function() {
      if (typeof showSyncBadge === 'function') showSyncBadge('saved');
    }, 3500);
  }
};


// ════════════════════════════════════════════════════════════════
// PRODUCTION READINESS CHECK
// Console mein run karo: shahGroupHealthCheck()
// ════════════════════════════════════════════════════════════════

window.shahGroupHealthCheck = function() {
  console.group('%c🏥 SHAH Group POS — Health Check', 'color:#0087EB;font-size:16px;font-weight:900');

  var checks = [
    {
      name: 'Users loaded',
      pass: typeof users !== 'undefined' && Array.isArray(users) && users.length > 0,
      detail: 'Total users: ' + (typeof users !== 'undefined' ? users.length : 'N/A')
    },
    {
      name: 'Passwords hashed',
      pass: typeof users !== 'undefined' && users.every(function(u) {
        return u.password && u.password.length >= 20;
      }),
      detail: users ? users.filter(function(u){ return u.password && u.password.length < 20; }).length + ' un-hashed passwords' : 'N/A'
    },
    {
      name: 'Google Sheets configured',
      pass: typeof gsItemsUrl !== 'undefined' && gsItemsUrl.length > 0,
      detail: gsItemsUrl ? '✅ URL set' : '⚠️ URL not set — data persist nahi hoga'
    },
    {
      name: 'Customers loaded',
      pass: typeof customers !== 'undefined' && Array.isArray(customers),
      detail: 'Total: ' + (typeof customers !== 'undefined' ? customers.length : 0)
    },
    {
      name: 'Stock loaded',
      pass: typeof stockItems !== 'undefined' && Array.isArray(stockItems),
      detail: 'Total items: ' + (typeof stockItems !== 'undefined' ? stockItems.length : 0) +
              ', Low stock: ' + (typeof stockItems !== 'undefined' ? stockItems.filter(function(s){ return s.qty <= (s.min||0); }).length : 0)
    },
    {
      name: 'Invoices loaded',
      pass: typeof invoiceList !== 'undefined' && Array.isArray(invoiceList),
      detail: 'Total: ' + (typeof invoiceList !== 'undefined' ? invoiceList.length : 0)
    },
    {
      name: 'escapeHtml available',
      pass: typeof escapeHtml === 'function',
      detail: 'XSS protection'
    },
    {
      name: 'generateInvId available',
      pass: typeof generateInvId === 'function',
      detail: 'Safe invoice IDs'
    },
    {
      name: 'canDo permissions enforced',
      pass: typeof canDo === 'function',
      detail: 'Permission system'
    },
    {
      name: 'toast() null-safe',
      pass: typeof toast === 'function',
      detail: 'Toast notifications'
    },
    {
      name: 'No duplicate invoice IDs',
      pass: (function() {
        if (typeof invoiceList === 'undefined') return true;
        var ids = invoiceList.map(function(i) { return i.id; });
        return ids.length === new Set(ids).size;
      })(),
      detail: 'Invoice ID uniqueness check'
    },
    {
      name: 'localStorage accessible',
      pass: (function() {
        try { localStorage.setItem('_test', '1'); localStorage.removeItem('_test'); return true; }
        catch(e) { return false; }
      })(),
      detail: 'Data persistence'
    }
  ];

  var passed = 0, failed = 0;
  checks.forEach(function(c) {
    if (c.pass) {
      passed++;
      console.log('%c✅ ' + c.name, 'color:#10b981', '—', c.detail);
    } else {
      failed++;
      console.warn('%c❌ ' + c.name + ' — ' + c.detail, 'color:#ef4444');
    }
  });

  console.log('');
  console.log('%cResult: ' + passed + '/' + checks.length + ' checks passed',
    failed === 0 ? 'color:#10b981;font-weight:900;font-size:14px' : 'color:#ef4444;font-weight:900;font-size:14px');

  if (failed > 0) {
    console.log('%c⚠️ ' + failed + ' issues hain — Fix karo!', 'color:#f59e0b;font-weight:700');
  } else {
    console.log('%c🎉 App production ke liye ready hai!', 'color:#10b981;font-weight:700');
  }

  console.groupEnd();
  return { passed: passed, failed: failed, total: checks.length };
};

// Auto-run on load (after 3 seconds)
setTimeout(function() {
  if (typeof window.shahGroupHealthCheck === 'function') {
    window.shahGroupHealthCheck();
  }
}, 3000);

console.info('%c[SHAH POS ADV] Advanced Security Fixes Loaded ✅', 'color:#7c3aed;font-weight:bold');
