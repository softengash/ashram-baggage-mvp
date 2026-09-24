// Ashram Digital Baggage Custody - MVP Server
// Single-file JSON datastore (no native/compiled dependencies) so this
// installs cleanly on a fresh machine with just `npm install express`.

const express = require('express');
const fs = require('fs');
const path = require('path');

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const DB_FILE = path.join(__dirname, 'data.json');
const PORT = process.env.PORT || 3000;
const MAX_ADMINS = 3;

// ---------- Config (edit these for your demo) ----------
const DEFAULT_CONFIG = {
  totalHooks: 30,
  retentionDays: 30,
  abandonedHours: 24,
  privacyNotice: 'Phone numbers are collected solely for baggage identity verification and are auto-deleted after collection.',
  // Seed volunteer roster. Only phone numbers listed here can log in.
  // Change/add real numbers before a real deployment.
  volunteers: [
    { name: 'Admin', phone: '+919999999999', isAdmin: true }
  ]
};

// ---------- Tiny JSON datastore ----------
function loadDB() {
  if (!fs.existsSync(DB_FILE)) {
    const initial = { config: DEFAULT_CONFIG, transactions: [], residents: [], nextId: 1 };
    fs.writeFileSync(DB_FILE, JSON.stringify(initial, null, 2));
    return initial;
  }
  const db = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
  if (!db.residents) db.residents = [];
  return db;
}
function saveDB(db) { fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2)); }
function nowISO() { return new Date().toISOString(); }
function hoursSince(isoString) { return (Date.now() - new Date(isoString).getTime()) / (1000 * 60 * 60); }

function findVolunteer(db, phone) { return db.config.volunteers.find(v => v.phone === phone); }
function isAdminPhone(db, phone) {
  const v = findVolunteer(db, phone);
  return !!(v && v.isAdmin);
}
function findResident(db, residentId) {
  const norm = String(residentId).trim().toLowerCase();
  return db.residents.find(r => r.residentId.toLowerCase() === norm);
}

// ==================================================================
// AUTH — phone + OTP (demo-simulated: the code is returned in the API
// response and logged to the server console instead of being SMS'd,
// since a real SMS gateway is out of scope for this MVP).
// ==================================================================
const otpStore = {}; // phone -> { code, expiresAt }  (in-memory, fine for a demo)
const OTP_TTL_MS = 5 * 60 * 1000;

app.post('/api/auth/request-otp', (req, res) => {
  const db = loadDB();
  const phone = String(req.body.phone || '');
  const volunteer = findVolunteer(db, phone);
  if (!volunteer) {
    return res.status(404).json({ error: 'This phone number is not registered as a volunteer. Ask an admin to add you first.' });
  }
  const code = String(Math.floor(100000 + Math.random() * 900000));
  otpStore[phone] = { code, expiresAt: Date.now() + OTP_TTL_MS };
  console.log(`[DEMO OTP] ${phone} (${volunteer.name}) -> ${code}`);
  res.json({
    ok: true,
    demoCode: code, // DEMO ONLY — a real deployment sends this via SMS and never returns it here
    demoNote: 'Demo mode: this code would normally be sent by SMS. Shown here since no SMS gateway is configured.'
  });
});

app.post('/api/auth/verify-otp', (req, res) => {
  const db = loadDB();
  const phone = String(req.body.phone || '');
  const code = String(req.body.code || '');
  const entry = otpStore[phone];
  if (!entry || entry.expiresAt < Date.now()) {
    return res.status(401).json({ error: 'Code expired or not requested. Please request a new code.' });
  }
  if (entry.code !== code) {
    return res.status(401).json({ error: 'Incorrect code.' });
  }
  delete otpStore[phone];
  const volunteer = findVolunteer(db, phone);
  if (!volunteer) return res.status(404).json({ error: 'Volunteer no longer registered.' });
  res.json({ ok: true, volunteer: { name: volunteer.name, phone: volunteer.phone, isAdmin: !!volunteer.isAdmin } });
});

// ==================================================================
// VOLUNTEER MANAGEMENT (admin-only)
// ==================================================================
app.get('/api/volunteers', (req, res) => {
  const db = loadDB();
  if (!isAdminPhone(db, req.query.requesterPhone)) return res.status(403).json({ error: 'Admin access required.' });
  res.json({ volunteers: db.config.volunteers.map(v => ({ name: v.name, phone: v.phone, isAdmin: !!v.isAdmin })) });
});

app.post('/api/volunteers/add', (req, res) => {
  const db = loadDB();
  const { requesterPhone, name, phone, isAdmin } = req.body;
  if (!isAdminPhone(db, requesterPhone)) return res.status(403).json({ error: 'Admin access required.' });
  if (!name || !phone) return res.status(400).json({ error: 'Name and phone number are required.' });
  if (findVolunteer(db, phone)) return res.status(409).json({ error: 'That phone number is already registered.' });

  const currentAdmins = db.config.volunteers.filter(v => v.isAdmin).length;
  if (isAdmin && currentAdmins >= MAX_ADMINS) {
    return res.status(400).json({ error: `Maximum of ${MAX_ADMINS} admin volunteers allowed.` });
  }

  db.config.volunteers.push({ name, phone: String(phone), isAdmin: !!isAdmin });
  saveDB(db);
  res.json({ ok: true, volunteers: db.config.volunteers.map(v => ({ name: v.name, phone: v.phone, isAdmin: !!v.isAdmin })) });
});

app.post('/api/volunteers/remove', (req, res) => {
  const db = loadDB();
  const { requesterPhone, phone } = req.body;
  if (!isAdminPhone(db, requesterPhone)) return res.status(403).json({ error: 'Admin access required.' });

  const target = findVolunteer(db, phone);
  if (!target) return res.status(404).json({ error: 'Volunteer not found.' });
  const adminCount = db.config.volunteers.filter(v => v.isAdmin).length;
  if (target.isAdmin && adminCount <= 1) {
    return res.status(400).json({ error: 'Cannot remove the last remaining admin.' });
  }

  db.config.volunteers = db.config.volunteers.filter(v => v.phone !== phone);
  saveDB(db);
  res.json({ ok: true, volunteers: db.config.volunteers.map(v => ({ name: v.name, phone: v.phone, isAdmin: !!v.isAdmin })) });
});

// ==================================================================
// CONFIG (public read; admin-only write)
// ==================================================================
app.get('/api/config', (req, res) => {
  const db = loadDB();
  const { totalHooks, retentionDays, abandonedHours, privacyNotice } = db.config;
  res.json({ totalHooks, retentionDays, abandonedHours, privacyNotice });
});

app.put('/api/config', (req, res) => {
  const db = loadDB();
  const { totalHooks, retentionDays, abandonedHours, privacyNotice, requesterPhone } = req.body;
  const admin = findVolunteer(db, requesterPhone);
  if (!admin || !admin.isAdmin) return res.status(403).json({ error: 'Admin access required to change settings.' });

  if (totalHooks) db.config.totalHooks = Number(totalHooks);
  if (retentionDays) db.config.retentionDays = Number(retentionDays);
  if (abandonedHours) db.config.abandonedHours = Number(abandonedHours);
  if (privacyNotice !== undefined && privacyNotice !== '') db.config.privacyNotice = privacyNotice;
  saveDB(db);
  res.json({ ok: true, changedBy: admin.name });
});

// ==================================================================
// RESIDENT ID DIRECTORY
// A resident's ID card barcode scans to a residentId. The first time an
// ID is seen, the volunteer registers it against a name + phone (once);
// every scan after that resolves straight to the stored phone, so the
// Deposit / Lost Token Recovery phone field can be filled from either an
// ID card or a spoken/typed phone number. This directory is intentionally
// separate from `transactions` (per-visit data) and is NOT touched by
// the retention purge below — it's a standing membership record, not a
// per-visit record.
// ==================================================================
app.get('/api/resident/:id', (req, res) => {
  const db = loadDB();
  const resident = findResident(db, req.params.id);
  if (!resident) return res.json({ found: false });
  res.json({ found: true, resident: { residentId: resident.residentId, name: resident.name, phone: resident.phone } });
});

app.post('/api/resident/register', (req, res) => {
  const db = loadDB();
  const { residentId, name, phone } = req.body;
  if (!residentId || !name || !phone) {
    return res.status(400).json({ error: 'Resident ID, name, and phone number are required.' });
  }
  if (findResident(db, residentId)) {
    return res.status(409).json({ error: 'This Resident ID is already registered.' });
  }
  const resident = { residentId: String(residentId).trim(), name, phone: String(phone), createdAt: nowISO() };
  db.residents.push(resident);
  saveDB(db);
  res.json({ ok: true, resident });
});

app.get('/api/residents', (req, res) => {
  const db = loadDB();
  if (!isAdminPhone(db, req.query.requesterPhone)) return res.status(403).json({ error: 'Admin access required.' });
  const q = String(req.query.q || '').toLowerCase();
  let results = db.residents;
  if (q) results = results.filter(r => r.residentId.toLowerCase().includes(q) || r.name.toLowerCase().includes(q));
  res.json({ residents: results });
});

// ---------- Offline-cache sync (read-only bulk exports) ----------
// The client caches these locally while online so a Resident ID scan or a
// token lookup still has something to check against with no connection -
// the offline queue only ever covered writes, not the reads that gate them.
app.get('/api/sync/residents', (req, res) => {
  const db = loadDB();
  res.json({ residents: db.residents.map(r => ({ residentId: r.residentId, name: r.name, phone: r.phone })) });
});

app.get('/api/sync/active-transactions', (req, res) => {
  const db = loadDB();
  const active = db.transactions
    .filter(t => t.status === 'active')
    .map(t => ({ token: t.token, phone: t.phone, name: t.name, residentId: t.residentId || null, bags: t.bags, valuables: t.valuables }));
  res.json({ transactions: active });
});

app.post('/api/residents/remove', (req, res) => {
  const db = loadDB();
  const { requesterPhone, residentId } = req.body;
  if (!isAdminPhone(db, requesterPhone)) return res.status(403).json({ error: 'Admin access required.' });
  const before = db.residents.length;
  db.residents = db.residents.filter(r => r.residentId !== residentId);
  if (db.residents.length === before) return res.status(404).json({ error: 'Resident not found.' });
  saveDB(db);
  res.json({ ok: true });
});

// ==================================================================
// DEPOSIT
// ==================================================================
app.post('/api/deposit', (req, res) => {
  const db = loadDB();
  const { token, phone, name, bags, valuables, volunteer, residentId } = req.body;

  if (!token || !phone || !volunteer) {
    return res.status(400).json({ error: 'Token, phone number, and volunteer are required.' });
  }

  // Safety-net check: catches typos / mixed-up baskets, does NOT replace the
  // physical basket as the real concurrency control.
  const existingActive = db.transactions.find(t => t.token === String(token) && t.status === 'active');
  if (existingActive) {
    return res.status(409).json({
      error: `Token ${token} is already marked OCCUPIED. Please recheck the basket/hook before proceeding.`
    });
  }

  const tx = {
    id: db.nextId++,
    token: String(token),
    phone: String(phone),
    name: name || '',
    residentId: residentId || null,
    bags: Number(bags) || 0,
    valuables: Number(valuables) || 0,
    status: 'active',
    depositedAt: nowISO(),
    collectedAt: null,
    volunteerDeposit: volunteer,
    volunteerCollect: null,
    lostTokenRecovery: false,
    recoveryNote: '',
    history: [{ action: 'deposit', at: nowISO(), by: volunteer }]
  };

  db.transactions.push(tx);
  saveDB(db);
  res.json({ ok: true, transaction: tx });
});

app.get('/api/customer/:phone', (req, res) => {
  const db = loadDB();
  const phone = req.params.phone;
  const matches = db.transactions
    .filter(t => t.phone === phone && t.name)
    .sort((a, b) => new Date(b.depositedAt) - new Date(a.depositedAt));
  res.json({ name: matches.length ? matches[0].name : '' });
});

// ---------- Token lookup (Collect screen: find + manage an active token) ----------
app.get('/api/deposit/:token', (req, res) => {
  const db = loadDB();
  const tx = db.transactions.find(t => t.token === req.params.token && t.status === 'active');
  if (!tx) return res.status(404).json({ error: 'No active deposit found for that token.' });
  res.json({ transaction: tx });
});

// ---------- Deposit add-on ----------
app.post('/api/deposit/addon', (req, res) => {
  const db = loadDB();
  const { token, addBags, addValuables, volunteer } = req.body;
  const tx = db.transactions.find(t => t.token === String(token) && t.status === 'active');
  if (!tx) return res.status(404).json({ error: 'No active deposit found for that token.' });

  tx.bags += Number(addBags) || 0;
  tx.valuables += Number(addValuables) || 0;
  tx.history.push({ action: 'addon', at: nowISO(), by: volunteer, addBags: Number(addBags) || 0, addValuables: Number(addValuables) || 0 });
  saveDB(db);
  res.json({ ok: true, transaction: tx });
});

// ---------- Edit an active transaction ----------
app.put('/api/deposit/:token', (req, res) => {
  const db = loadDB();
  const tx = db.transactions.find(t => t.token === req.params.token && t.status === 'active');
  if (!tx) return res.status(404).json({ error: 'No active deposit found for that token.' });

  const { phone, name, bags, valuables, volunteer } = req.body;
  const changes = {};
  if (phone !== undefined) { changes.phone = { from: tx.phone, to: phone }; tx.phone = String(phone); }
  if (name !== undefined) { changes.name = { from: tx.name, to: name }; tx.name = name; }
  if (bags !== undefined) { changes.bags = { from: tx.bags, to: Number(bags) }; tx.bags = Number(bags); }
  if (valuables !== undefined) { changes.valuables = { from: tx.valuables, to: Number(valuables) }; tx.valuables = Number(valuables); }

  tx.history.push({ action: 'edit', at: nowISO(), by: volunteer || 'unknown', changes });
  saveDB(db);
  res.json({ ok: true, transaction: tx });
});

// ---------- Collection (normal path: physical token required) ----------
app.post('/api/collect', (req, res) => {
  const db = loadDB();
  const { token, volunteer } = req.body;
  const tx = db.transactions.find(t => t.token === String(token) && t.status === 'active');
  if (!tx) return res.status(404).json({ error: 'No active deposit found for that token.' });

  tx.status = 'collected';
  tx.collectedAt = nowISO();
  tx.volunteerCollect = volunteer;
  tx.history.push({ action: 'collect', at: nowISO(), by: volunteer });
  saveDB(db);
  res.json({ ok: true, transaction: tx });
});

// ---------- Partial collection ----------
app.post('/api/collect/partial', (req, res) => {
  const db = loadDB();
  const { token, bags, valuables, volunteer } = req.body;
  const tx = db.transactions.find(t => t.token === String(token) && t.status === 'active');
  if (!tx) return res.status(404).json({ error: 'No active deposit found for that token.' });

  const takeBags = Number(bags) || 0;
  const takeValuables = Number(valuables) || 0;
  if (takeBags > tx.bags || takeValuables > tx.valuables) {
    return res.status(400).json({ error: `Cannot collect more than what's stored (has ${tx.bags} bag(s), ${tx.valuables} valuable(s)).` });
  }
  if (takeBags === 0 && takeValuables === 0) {
    return res.status(400).json({ error: 'Select at least one item to collect.' });
  }

  tx.bags -= takeBags;
  tx.valuables -= takeValuables;
  tx.history.push({ action: 'partial-collect', at: nowISO(), by: volunteer, tookBags: takeBags, tookValuables: takeValuables });

  if (tx.bags === 0 && tx.valuables === 0) {
    tx.status = 'collected';
    tx.collectedAt = nowISO();
    tx.volunteerCollect = volunteer;
    tx.history.push({ action: 'collect', at: nowISO(), by: volunteer, note: 'Auto-closed after final partial collection.' });
  }

  saveDB(db);
  res.json({ ok: true, transaction: tx });
});

// ---------- Lost token recovery ----------
app.get('/api/lookup/phone/:phone', (req, res) => {
  const db = loadDB();
  const matches = db.transactions.filter(t => t.phone === req.params.phone && t.status === 'active');
  res.json({ matches });
});

app.post('/api/collect/lost-token', (req, res) => {
  const db = loadDB();
  const { token, volunteer, recoveryNote } = req.body;
  const tx = db.transactions.find(t => t.token === String(token) && t.status === 'active');
  if (!tx) return res.status(404).json({ error: 'No active deposit found for that token.' });

  tx.status = 'collected';
  tx.collectedAt = nowISO();
  tx.volunteerCollect = volunteer;
  tx.lostTokenRecovery = true;
  tx.recoveryNote = recoveryNote || '';
  tx.history.push({ action: 'lost-token-collect', at: nowISO(), by: volunteer, note: recoveryNote || '' });
  saveDB(db);
  res.json({ ok: true, transaction: tx });
});

// ==================================================================
// OCCUPANCY (includes occupied token list, for the hook-grid visual)
// ==================================================================
app.get('/api/occupancy', (req, res) => {
  const db = loadDB();
  const activeTx = db.transactions.filter(t => t.status === 'active');
  const abandoned = activeTx.filter(t => hoursSince(t.depositedAt) >= db.config.abandonedHours).length;
  res.json({
    total: db.config.totalHooks,
    occupied: activeTx.length,
    free: Math.max(db.config.totalHooks - activeTx.length, 0),
    abandoned,
    occupiedTokens: activeTx.map(t => t.token)
  });
});

// ---------- History / search ----------
app.get('/api/history', (req, res) => {
  const db = loadDB();
  const q = (req.query.q || '').toLowerCase();
  let results = db.transactions;
  if (q) {
    results = results.filter(t =>
      t.token.toLowerCase().includes(q) ||
      t.phone.toLowerCase().includes(q) ||
      (t.name || '').toLowerCase().includes(q) ||
      (t.residentId || '').toLowerCase().includes(q)
    );
  }
  results = results
    .slice()
    .sort((a, b) => new Date(b.depositedAt) - new Date(a.depositedAt))
    .map(t => ({ ...t, abandoned: t.status === 'active' && hoursSince(t.depositedAt) >= db.config.abandonedHours }));
  res.json({ results });
});

// ==================================================================
// PRIVACY: AUTO-PURGE
// ==================================================================
function runPurge(db) {
  const retentionDays = db.config.retentionDays;
  let purgedCount = 0;
  db.transactions.forEach(t => {
    if (t.status === 'collected' && t.collectedAt) {
      const daysSince = (Date.now() - new Date(t.collectedAt).getTime()) / (1000 * 60 * 60 * 24);
      if (daysSince >= retentionDays && t.phone !== '[purged]') {
        t.phone = '[purged]';
        t.name = '[purged]';
        t.purgedAt = nowISO();
        purgedCount++;
      }
    }
  });
  return purgedCount;
}

app.post('/api/purge/run', (req, res) => {
  const db = loadDB();
  const admin = findVolunteer(db, req.body.requesterPhone);
  if (!admin || !admin.isAdmin) return res.status(403).json({ error: 'Admin access required.' });
  const purgedCount = runPurge(db);
  saveDB(db);
  res.json({ ok: true, purgedCount, runBy: admin.name });
});

setInterval(() => {
  const db = loadDB();
  const purgedCount = runPurge(db);
  if (purgedCount > 0) {
    saveDB(db);
    console.log(`[auto-purge] Purged personal data from ${purgedCount} old transaction(s).`);
  }
}, 60 * 60 * 1000);

// ---------- Start ----------
app.listen(PORT, '0.0.0.0', () => {
  console.log('=================================================');
  console.log('  Ashram Digital Baggage Custody - MVP running');
  console.log(`  Local:   http://localhost:${PORT}`);
  console.log('  Default demo admin phone: +919999999999');
  console.log('  (OTP codes print here in the console, and also');
  console.log('   show on-screen in the app for the demo.)');
  console.log('=================================================');
});
