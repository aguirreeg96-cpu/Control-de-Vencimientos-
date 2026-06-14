/* ============================================================
   LOGICONTROL PRO — script.js
   ============================================================ */

'use strict';

// ─── CONSTANTS ───────────────────────────────────────────────
const STORAGE_KEY = 'lcpro_';
const COLORS = {
  red: '#ef4444', orange: '#f97316', yellow: '#f59e0b',
  green: '#22c55e', blue: '#2563eb', sky: '#38bdf8',
  redBg: '#fee2e2', orangeBg: '#ffedd5', yellowBg: '#fef9c3',
  greenBg: '#dcfce7', blueBg: '#dbeafe'
};

const EXPIRATION_TYPES = {
  vehicle: ['Seguro de Responsabilidad Civil','VTV / RTO','Matafuegos','Habilitación Municipal','Verificación Técnica Vehicular','Tacógrafo / Cronotacógrafo','Revisión de Frenos','Otro'],
  driver: ['Licencia de Conducir','Psicofísico','ART','Curso de Cargas Peligrosas','Examen Médico Laboral','Otro'],
  company: ['Habilitación Empresa','Póliza de Seguro General','Habilitación SENASA','Certificación ISO','Registro Transportista','Otro'],
  waste: ['Habilitación Ambiental','Permiso de Transporte','Póliza Ambiental','Contrato de Cliente','Certificado Regulatorio','Manifiesto Residuos','Otro']
};

const CATEGORY_LABELS = { vehicle: 'Vehículo', driver: 'Chofer', company: 'Empresa', waste: 'Residuos' };

// ─── STATE ───────────────────────────────────────────────────
const State = {
  vehicles: [], drivers: [], expirations: [],
  hazardous: [], history: [],
  currentView: 'dashboard',
  calendarDate: new Date(),
  editingId: null,
  editingType: null,
  modalSaveCallback: null
};

// ─── STORAGE ─────────────────────────────────────────────────
const DB = {
  save(key, data) { try { localStorage.setItem(STORAGE_KEY + key, JSON.stringify(data)); } catch(e){} },
  load(key, def=[]) { try { return JSON.parse(localStorage.getItem(STORAGE_KEY + key)) ?? def; } catch(e){ return def; } },
  loadBool(key) { return localStorage.getItem(STORAGE_KEY + key) === 'true'; }
};

function persistAll() {
  DB.save('vehicles', State.vehicles);
  DB.save('drivers', State.drivers);
  DB.save('expirations', State.expirations);
  DB.save('hazardous', State.hazardous);
  DB.save('history', State.history);
}

// ─── UTILITIES ───────────────────────────────────────────────
function genId() { return Date.now().toString(36) + Math.random().toString(36).substr(2,5); }

function today() { const d = new Date(); d.setHours(0,0,0,0); return d; }

function addDays(d, n) { const r = new Date(d); r.setDate(r.getDate() + n); return r; }

function fmtDate(s) {
  if (!s) return '—';
  const d = new Date(s + 'T00:00:00');
  return d.toLocaleDateString('es-AR', { day:'2-digit', month:'2-digit', year:'numeric' });
}

function fmtDatetime(s) {
  if (!s) return '—';
  return new Date(s).toLocaleString('es-AR', { day:'2-digit', month:'2-digit', year:'numeric', hour:'2-digit', minute:'2-digit' });
}

function toISO(d) { return d.toISOString().split('T')[0]; }

function getDays(isoStr) {
  if (!isoStr) return null;
  const t = today();
  const e = new Date(isoStr + 'T00:00:00');
  return Math.ceil((e - t) / 86400000);
}

function getStatus(isoStr) {
  if (!isoStr) return 'ok';
  const d = getDays(isoStr);
  if (d === null) return 'ok';
  if (d < 0) return 'expired';
  if (d <= 15) return 'critical';
  if (d <= 30) return 'warning';
  if (d <= 60) return 'caution';
  return 'ok';
}

function statusLabel(s) {
  return { expired:'VENCIDO', critical:'CRÍTICO', warning:'ADVERTENCIA', caution:'PRECAUCIÓN', ok:'VIGENTE' }[s] || s;
}

function statusBadge(status, text) {
  const t = text || statusLabel(status);
  return `<span class="badge badge-${status}">${t}</span>`;
}

function daysLabel(days) {
  if (days === null) return '—';
  if (days < 0) return `Vencido hace ${Math.abs(days)} días`;
  if (days === 0) return 'Vence hoy';
  if (days === 1) return 'Vence mañana';
  return `${days} días`;
}

function isVehicleBlocked(vid) {
  return State.expirations.some(e => e.vehicleId === vid && getStatus(e.expiryDate) === 'expired');
}

function isDriverBlocked(did) {
  return State.expirations.some(e => e.driverId === did && getStatus(e.expiryDate) === 'expired');
}

function getVehicleStatus(vid) {
  const exps = State.expirations.filter(e => e.vehicleId === vid);
  if (exps.some(e => getStatus(e.expiryDate) === 'expired')) return 'blocked';
  if (exps.some(e => ['critical','warning'].includes(getStatus(e.expiryDate)))) return 'alert';
  return 'operational';
}

function getDriverStatus(did) {
  const exps = State.expirations.filter(e => e.driverId === did);
  if (exps.some(e => getStatus(e.expiryDate) === 'expired')) return 'blocked';
  if (exps.some(e => ['critical','warning'].includes(getStatus(e.expiryDate)))) return 'warning';
  return 'ok';
}

function vehicleStatusBadge(vid) {
  const s = getVehicleStatus(vid);
  if (s === 'blocked') return `<span class="badge badge-blocked">BLOQUEADO</span>`;
  if (s === 'alert') return `<span class="badge badge-warning">ALERTA</span>`;
  return `<span class="badge badge-operational">OPERATIVO</span>`;
}

function driverStatusBadge(did) {
  const s = getDriverStatus(did);
  if (s === 'blocked') return `<span class="badge badge-blocked">NO HABILITADO</span>`;
  if (s === 'warning') return `<span class="badge badge-warning">PROXIMO A VENCER</span>`;
  return `<span class="badge badge-ok">HABILITADO</span>`;
}

function escHtml(s) {
  return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function logHistory(action, entityType, entityId, entityName, description) {
  State.history.unshift({
    id: genId(), action, entityType, entityId, entityName, description,
    timestamp: new Date().toISOString()
  });
  if (State.history.length > 200) State.history.length = 200;
  DB.save('history', State.history);
}

function getDriverName(did) {
  const d = State.drivers.find(d => d.id === did);
  return d ? `${d.name} ${d.lastName}` : '—';
}
function getVehicleName(vid) {
  const v = State.vehicles.find(v => v.id === vid);
  return v ? v.patent : '—';
}

// ─── DEMO DATA ───────────────────────────────────────────────
function generateDemoData() {
  if (DB.loadBool('initialized')) return;

  const t = today();
  const rel = n => toISO(addDays(t, n));

  const driverNames = [
    ['Juan','Pérez'],['Carlos','González'],['Roberto','Martínez'],['Diego','Rodríguez'],
    ['Miguel','Fernández'],['Pablo','López'],['Alejandro','García'],['Sebastián','Torres'],
    ['Marcelo','Ramírez'],['Nicolás','Herrera'],['Gustavo','Ruiz'],['Fernando','Sánchez'],
    ['Eduardo','Morales'],['Adrián','Delgado'],['Horacio','Vargas']
  ];
  const licCats = ['C','D','D','E','D','C','E','D','C','D','E','C','D','D','C'];
  const drivers = driverNames.map(([name,lastName],i) => ({
    id: `d${i+1}`, name, lastName,
    dni: String(20000000 + i*1234567),
    licenseNumber: `LIC-${String(100000+i*7).padStart(6,'0')}`,
    licenseCategory: licCats[i],
    notes: ''
  }));
  State.drivers = drivers;

  const vehicleData = [
    ['AB 123 CD','Mercedes-Benz','Actros 2651',2019,'d1'],
    ['BC 456 DE','Scania','R420',2020,'d2'],
    ['CD 789 EF','Volvo','FH 460',2018,'d3'],
    ['DE 012 FG','Ford','Cargo 1722',2017,'d4'],
    ['EF 345 GH','Renault','Master',2021,'d5'],
    ['FG 678 HI','Iveco','Stralis AT',2019,'d6'],
    ['GH 901 IJ','MAN','TGX 26.440',2022,'d7'],
    ['HI 234 JK','DAF','XF 105',2018,'d8'],
    ['IJ 567 KL','Scania','G360',2020,'d9'],
    ['JK 890 LM','Mercedes-Benz','Sprinter 515',2021,'d10'],
    ['KL 123 MN','Ford','Transit',2022,'d11'],
    ['LM 456 NO','Volkswagen','Constellation',2019,'d12'],
    ['MN 789 OP','Fiat','Ducato Cargo',2020,'d13'],
    ['NO 012 PQ','Toyota','Hilux 4x4',2021,'d14'],
    ['OP 345 QR','Chevrolet','S10 Cab.Doble',2022,'d15']
  ];
  State.vehicles = vehicleData.map(([patent,brand,model,year,driverId],i) => ({
    id: `v${i+1}`, patent, brand, model, year, driverId, notes: ''
  }));

  // 50 expirations with varied dates
  const expDefs = [
    // EXPIRED (past) - 12 items
    {type:'Seguro de Responsabilidad Civil',cat:'vehicle',vid:'v1',did:null,issue:rel(-400),exp:rel(-30)},
    {type:'VTV / RTO',cat:'vehicle',vid:'v2',did:null,issue:rel(-380),exp:rel(-15)},
    {type:'Matafuegos',cat:'vehicle',vid:'v3',did:null,issue:rel(-370),exp:rel(-5)},
    {type:'Licencia de Conducir',cat:'driver',vid:null,did:'d1',issue:rel(-1200),exp:rel(-10)},
    {type:'Psicofísico',cat:'driver',vid:null,did:'d2',issue:rel(-370),exp:rel(-20)},
    {type:'ART',cat:'driver',vid:null,did:'d3',issue:rel(-380),exp:rel(-8)},
    {type:'Habilitación Empresa',cat:'company',vid:null,did:null,issue:rel(-400),exp:rel(-60)},
    {type:'Póliza de Seguro General',cat:'company',vid:null,did:null,issue:rel(-400),exp:rel(-45)},
    {type:'Habilitación Ambiental',cat:'waste',vid:null,did:null,issue:rel(-400),exp:rel(-90)},
    {type:'Verificación Técnica Vehicular',cat:'vehicle',vid:'v4',did:null,issue:rel(-400),exp:rel(-3)},
    {type:'Curso de Cargas Peligrosas',cat:'driver',vid:null,did:'d4',issue:rel(-400),exp:rel(-25)},
    {type:'Permiso de Transporte',cat:'waste',vid:null,did:null,issue:rel(-400),exp:rel(-12)},
    // CRITICAL (0-15 days) - 8 items
    {type:'Seguro de Responsabilidad Civil',cat:'vehicle',vid:'v5',did:null,issue:rel(-365),exp:rel(5)},
    {type:'VTV / RTO',cat:'vehicle',vid:'v6',did:null,issue:rel(-365),exp:rel(10)},
    {type:'Psicofísico',cat:'driver',vid:null,did:'d5',issue:rel(-365),exp:rel(7)},
    {type:'ART',cat:'driver',vid:null,did:'d6',issue:rel(-365),exp:rel(3)},
    {type:'Licencia de Conducir',cat:'driver',vid:null,did:'d7',issue:rel(-1825),exp:rel(12)},
    {type:'Habilitación Municipal',cat:'vehicle',vid:'v7',did:null,issue:rel(-365),exp:rel(14)},
    {type:'Tacógrafo / Cronotacógrafo',cat:'vehicle',vid:'v8',did:null,issue:rel(-365),exp:rel(8)},
    {type:'Póliza Ambiental',cat:'waste',vid:null,did:null,issue:rel(-365),exp:rel(6)},
    // WARNING (16-30 days) - 10 items
    {type:'Seguro de Responsabilidad Civil',cat:'vehicle',vid:'v9',did:null,issue:rel(-335),exp:rel(20)},
    {type:'VTV / RTO',cat:'vehicle',vid:'v10',did:null,issue:rel(-335),exp:rel(25)},
    {type:'Matafuegos',cat:'vehicle',vid:'v11',did:null,issue:rel(-335),exp:rel(28)},
    {type:'Psicofísico',cat:'driver',vid:null,did:'d8',issue:rel(-335),exp:rel(22)},
    {type:'ART',cat:'driver',vid:null,did:'d9',issue:rel(-335),exp:rel(17)},
    {type:'Curso de Cargas Peligrosas',cat:'driver',vid:null,did:'d10',issue:rel(-335),exp:rel(29)},
    {type:'Verificación Técnica Vehicular',cat:'vehicle',vid:'v12',did:null,issue:rel(-335),exp:rel(23)},
    {type:'Habilitación SENASA',cat:'company',vid:null,did:null,issue:rel(-335),exp:rel(30)},
    {type:'Contrato de Cliente',cat:'waste',vid:null,did:null,issue:rel(-335),exp:rel(18)},
    {type:'Habilitación Municipal',cat:'vehicle',vid:'v13',did:null,issue:rel(-335),exp:rel(26)},
    // CAUTION (31-60 days) - 10 items
    {type:'Seguro de Responsabilidad Civil',cat:'vehicle',vid:'v14',did:null,issue:rel(-305),exp:rel(40)},
    {type:'VTV / RTO',cat:'vehicle',vid:'v15',did:null,issue:rel(-305),exp:rel(55)},
    {type:'Licencia de Conducir',cat:'driver',vid:null,did:'d11',issue:rel(-1700),exp:rel(45)},
    {type:'Psicofísico',cat:'driver',vid:null,did:'d12',issue:rel(-305),exp:rel(35)},
    {type:'ART',cat:'driver',vid:null,did:'d13',issue:rel(-305),exp:rel(58)},
    {type:'Certificado Regulatorio',cat:'waste',vid:null,did:null,issue:rel(-305),exp:rel(42)},
    {type:'Registro Transportista',cat:'company',vid:null,did:null,issue:rel(-305),exp:rel(50)},
    {type:'Matafuegos',cat:'vehicle',vid:'v1',did:null,issue:rel(-305),exp:rel(38)},
    {type:'Examen Médico Laboral',cat:'driver',vid:null,did:'d14',issue:rel(-305),exp:rel(48)},
    {type:'Tacógrafo / Cronotacógrafo',cat:'vehicle',vid:'v2',did:null,issue:rel(-305),exp:rel(60)},
    // OK (61+ days) - 10 items
    {type:'Seguro de Responsabilidad Civil',cat:'vehicle',vid:'v3',did:null,issue:rel(-100),exp:rel(90)},
    {type:'VTV / RTO',cat:'vehicle',vid:'v4',did:null,issue:rel(-100),exp:rel(180)},
    {type:'Licencia de Conducir',cat:'driver',vid:null,did:'d15',issue:rel(-1000),exp:rel(365)},
    {type:'Psicofísico',cat:'driver',vid:null,did:'d1',issue:rel(-100),exp:rel(265)},
    {type:'ART',cat:'driver',vid:null,did:'d2',issue:rel(-100),exp:rel(270)},
    {type:'Habilitación Empresa',cat:'company',vid:null,did:null,issue:rel(-100),exp:rel(265)},
    {type:'Póliza de Seguro General',cat:'company',vid:null,did:null,issue:rel(-100),exp:rel(330)},
    {type:'Habilitación Ambiental',cat:'waste',vid:null,did:null,issue:rel(-100),exp:rel(245)},
    {type:'Matafuegos',cat:'vehicle',vid:'v5',did:null,issue:rel(-100),exp:rel(160)},
    {type:'Certificado Regulatorio',cat:'waste',vid:null,did:null,issue:rel(-100),exp:rel(300)},
  ];

  State.expirations = expDefs.map((e,i) => ({
    id: `e${i+1}`, type: e.type, category: e.cat,
    vehicleId: e.vid, driverId: e.did,
    issueDate: e.issue, expiryDate: e.exp,
    description: '', observations: ''
  }));

  State.hazardous = [
    {id:'h1',type:'Habilitación Ambiental',entityName:'LogiCorp S.A.',permitNumber:'HA-2024-001',issuingAuthority:'Min. Ambiente Nación',issueDate:rel(-400),expiryDate:rel(-90),observations:'Renovación en trámite'},
    {id:'h2',type:'Permiso de Transporte',entityName:'LogiCorp S.A.',permitNumber:'PT-2024-002',issuingAuthority:'Sec. Transporte',issueDate:rel(-365),expiryDate:rel(5),observations:''},
    {id:'h3',type:'Póliza Ambiental',entityName:'LogiCorp S.A.',permitNumber:'POL-2024-003',issuingAuthority:'Mapfre Argentina',issueDate:rel(-300),expiryDate:rel(65),observations:''},
    {id:'h4',type:'Contrato de Cliente',entityName:'Petroquímica del Sur',permitNumber:'CC-2024-004',issuingAuthority:'Petroquímica del Sur S.A.',issueDate:rel(-200),expiryDate:rel(165),observations:'Contrato marco anual'},
    {id:'h5',type:'Certificado Regulatorio',entityName:'LogiCorp S.A.',permitNumber:'CR-2024-005',issuingAuthority:'OPDS Prov. BA',issueDate:rel(-100),expiryDate:rel(265),observations:''},
    {id:'h6',type:'Manifiesto Residuos',entityName:'Planta Norte',permitNumber:'MR-2024-006',issuingAuthority:'Municipalidad',issueDate:rel(-50),expiryDate:rel(315),observations:''},
    {id:'h7',type:'Habilitación Ambiental',entityName:'Sucursal Rosario',permitNumber:'HA-2024-007',issuingAuthority:'Min. Ambiente Pcia.',issueDate:rel(-365),expiryDate:rel(25),observations:''},
    {id:'h8',type:'Permiso de Transporte',entityName:'LogiCorp Norte',permitNumber:'PT-2024-008',issuingAuthority:'Sec. Transporte',issueDate:rel(-200),expiryDate:rel(160),observations:'Incluye rutas provinciales'},
  ];

  const actionNames = ['create','create','create','update','create','create','update','delete','create','create','renew','create','update','create','create','create','update','renew','create','create'];
  const entities = ['vehicle','driver','expiration','vehicle','driver','expiration','vehicle','driver','expiration','hazardous','expiration','driver','vehicle','expiration','driver','vehicle','expiration','driver','vehicle','hazardous'];
  const descs = [
    'Vehículo AB 123 CD registrado en el sistema','Chofer Juan Pérez agregado','Seguro RC vencimiento cargado',
    'Datos de vehículo BC 456 DE actualizados','Chofer Carlos González agregado','VTV de vehículo CD 789 EF cargado',
    'Patente EF 345 GH actualizada','Chofer Diego Rodríguez eliminado','Matafuegos vehículo DE 012 FG',
    'Habilitación ambiental registrada','Seguro RC renovado — nuevo vto. + 1 año','Chofer Roberto Martínez agregado',
    'Año de fabricación vehículo GH 901 IJ corregido','Psicofísico chofer Miguel Fernández','Chofer Pablo López agregado',
    'Vehículo HI 234 JK registrado','ART actualizada chofer Alejandro García','Psicofísico renovado — chofer Marcelo Ramírez',
    'Vehículo IJ 567 KL registrado','Permiso transporte residuos actualizado'
  ];

  State.history = actionNames.map((action,i) => ({
    id: `hist${i+1}`, action, entityType: entities[i], entityId: `x${i}`,
    entityName: descs[i].split(' ').slice(0,3).join(' '),
    description: descs[i],
    timestamp: addDays(today(), -(i*2+1)).toISOString()
  }));

  persistAll();
  localStorage.setItem(STORAGE_KEY + 'initialized', 'true');
}

// ─── ALERTS ──────────────────────────────────────────────────
function getAllAlerts() {
  const alerts = [];
  State.expirations.forEach(e => {
    const status = getStatus(e.expiryDate);
    if (status === 'ok') return;
    const days = getDays(e.expiryDate);
    let entityName = '—', entityType = CATEGORY_LABELS[e.category] || 'Empresa';
    if (e.vehicleId) entityName = getVehicleName(e.vehicleId);
    else if (e.driverId) entityName = getDriverName(e.driverId);
    else entityName = 'Empresa';
    alerts.push({ id: e.id, status, days, type: e.type, entityName, entityType, category: e.category, expiryDate: e.expiryDate });
  });
  State.hazardous.forEach(h => {
    const status = getStatus(h.expiryDate);
    if (status === 'ok') return;
    const days = getDays(h.expiryDate);
    alerts.push({ id: h.id, status, days, type: h.type, entityName: h.entityName, entityType: 'Residuos', category: 'waste', expiryDate: h.expiryDate });
  });
  const order = { expired:0, critical:1, warning:2, caution:3 };
  alerts.sort((a,b) => (order[a.status]??9) - (order[b.status]??9) || a.days - b.days);
  return alerts;
}

function getStats() {
  const exps = State.expirations;
  const haz = State.hazardous;
  const all = [...exps.map(e => e.expiryDate), ...haz.map(h => h.expiryDate)];
  const total = all.length;
  const expired = all.filter(d => getStatus(d) === 'expired').length;
  const critical = all.filter(d => getStatus(d) === 'critical').length;
  const warning = all.filter(d => getStatus(d) === 'warning').length;
  const caution = all.filter(d => getStatus(d) === 'caution').length;
  const ok = all.filter(d => getStatus(d) === 'ok').length;
  const upcomingSum = expired + critical + warning;
  const blockedVehicles = State.vehicles.filter(v => isVehicleBlocked(v.id)).length;
  const blockedDrivers = State.drivers.filter(d => isDriverBlocked(d.id)).length;
  const riskScore = total > 0 ? Math.round((expired*3 + critical*2 + warning*1) / total * 33) : 0;
  return { total, expired, critical, warning, caution, ok, upcomingSum, blockedVehicles, blockedDrivers, riskScore };
}

// ─── NAVIGATION ──────────────────────────────────────────────
function navigate(view) {
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  document.querySelectorAll('.nav-link').forEach(l => l.classList.remove('active'));
  const el = document.getElementById('view-' + view);
  if (el) el.classList.add('active');
  const link = document.querySelector(`.nav-link[data-view="${view}"]`);
  if (link) link.classList.add('active');
  State.currentView = view;
  renderView(view);
  updateBadges();
}

function renderView(view) {
  const renderers = {
    dashboard: renderDashboard,
    alerts: renderAlerts,
    vehicles: renderVehicles,
    drivers: renderDrivers,
    expirations: renderExpirations,
    hazardous: renderHazardous,
    calendar: renderCalendar,
    reports: renderReports,
    history: renderHistory
  };
  if (renderers[view]) renderers[view]();
}

function updateBadges() {
  const stats = getStats();
  const alertCount = stats.expired + stats.critical + stats.warning;
  const setBadge = (id, n) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.textContent = n;
    el.style.display = n > 0 ? 'inline-flex' : 'none';
  };
  setBadge('badge-alerts', alertCount);
  setBadge('badge-vehicles', stats.blockedVehicles);
  setBadge('badge-drivers', stats.blockedDrivers);
  const notifDot = document.getElementById('notif-dot');
  if (notifDot) notifDot.style.display = alertCount > 0 ? 'block' : 'none';
}

// ─── TOAST ───────────────────────────────────────────────────
function toast(msg, type='success') {
  const c = document.getElementById('toast-container');
  if (!c) return;
  const t = document.createElement('div');
  t.className = `toast ${type}`;
  t.textContent = msg;
  c.appendChild(t);
  setTimeout(() => { t.classList.add('removing'); setTimeout(() => t.remove(), 300); }, 3500);
}

// ─── MODAL ───────────────────────────────────────────────────
function openModal(title, bodyHtml, onSave, wide=false) {
  document.getElementById('modal-title').textContent = title;
  document.getElementById('modal-body').innerHTML = bodyHtml;
  const overlay = document.getElementById('modal-overlay');
  overlay.style.display = 'flex';
  overlay.style.position = 'fixed';
  overlay.style.inset = '0';
  overlay.style.background = 'rgba(15,23,42,0.6)';
  overlay.style.alignItems = 'center';
  overlay.style.justifyContent = 'center';
  overlay.style.zIndex = '1000';
  overlay.style.backdropFilter = 'blur(2px)';
  overlay.style.padding = '20px';
  const modal = document.getElementById('modal');
  if (modal) modal.style.maxWidth = wide ? '720px' : '560px';
  State.modalSaveCallback = onSave;
}

function closeModal() {
  document.getElementById('modal-overlay').style.display = 'none';
  document.getElementById('modal-body').innerHTML = '';
  State.modalSaveCallback = null;
}

// ─── SEARCH ──────────────────────────────────────────────────
function doSearch(q) {
  const dd = document.getElementById('search-results');
  if (!q || q.length < 2) { dd.style.display = 'none'; return; }
  q = q.toLowerCase();
  const results = [];
  State.vehicles.filter(v =>
    v.patent.toLowerCase().includes(q) || v.brand.toLowerCase().includes(q) || v.model.toLowerCase().includes(q)
  ).forEach(v => results.push({ type:'vehicle', id:v.id, title:`${v.patent}`, sub:`${v.brand} ${v.model} · ${v.year}` }));
  State.drivers.filter(d =>
    `${d.name} ${d.lastName}`.toLowerCase().includes(q) || d.dni.includes(q)
  ).forEach(d => results.push({ type:'driver', id:d.id, title:`${d.name} ${d.lastName}`, sub:`DNI ${d.dni} · Cat. ${d.licenseCategory}` }));
  State.expirations.filter(e =>
    e.type.toLowerCase().includes(q) || (e.description||'').toLowerCase().includes(q)
  ).forEach(e => results.push({ type:'expiration', id:e.id, title:e.type, sub:`${CATEGORY_LABELS[e.category]} · Vto. ${fmtDate(e.expiryDate)}` }));

  if (!results.length) {
    dd.innerHTML = `<div class="search-group-title" style="padding:16px;color:#94a3b8">Sin resultados para "${escHtml(q)}"</div>`;
  } else {
    const icons = {
      vehicle: `<svg width="16" height="16" viewBox="0 0 16 16" fill="none"><rect x="1" y="5" width="14" height="8" rx="1.5" stroke="currentColor" stroke-width="1.3"/><path d="M3 5V3.5C3 3 3.5 2.5 4 2.5H12C12.5 2.5 13 3 13 3.5V5" stroke="currentColor" stroke-width="1.3"/><circle cx="4" cy="13.5" r="1.5" stroke="currentColor" stroke-width="1.3"/><circle cx="12" cy="13.5" r="1.5" stroke="currentColor" stroke-width="1.3"/></svg>`,
      driver: `<svg width="16" height="16" viewBox="0 0 16 16" fill="none"><circle cx="8" cy="5" r="3" stroke="currentColor" stroke-width="1.3"/><path d="M2 14c0-3 2.7-5 6-5s6 2 6 5" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/></svg>`,
      expiration: `<svg width="16" height="16" viewBox="0 0 16 16" fill="none"><rect x="2" y="2" width="12" height="12" rx="1.5" stroke="currentColor" stroke-width="1.3"/><path d="M5 6h6M5 9h6M5 12h3" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/></svg>`
    };
    const typeLabel = {vehicle:'Vehículos',driver:'Choferes',expiration:'Vencimientos'};
    let html = '';
    ['vehicle','driver','expiration'].forEach(type => {
      const group = results.filter(r => r.type === type);
      if (!group.length) return;
      html += `<div class="search-group-title">${typeLabel[type]}</div>`;
      group.slice(0,4).forEach(r => {
        html += `<div class="search-item" onclick="navigate('${type==='expiration'?'expirations':type+'s'}');closeSearch()">
          <span style="color:var(--accent)">${icons[type]}</span>
          <div><div class="search-item-title">${escHtml(r.title)}</div><div class="search-item-sub">${escHtml(r.sub)}</div></div>
        </div>`;
      });
    });
    dd.innerHTML = html;
  }
  dd.style.display = 'block';
}

function closeSearch() {
  const dd = document.getElementById('search-results');
  const inp = document.getElementById('search-input');
  if (dd) dd.style.display = 'none';
  if (inp) inp.value = '';
}

// ─── CHARTS ──────────────────────────────────────────────────
function drawDonut(canvasId, segments, title) {
  const canvas = document.getElementById(canvasId);
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const W = canvas.width, H = canvas.height;
  const cx = W/2, cy = H/2, R = Math.min(cx,cy)-10, r = R*0.58;
  ctx.clearRect(0,0,W,H);
  const total = segments.reduce((s,x)=>s+x.value,0);
  if (!total) {
    ctx.fillStyle = '#e2e8f0';
    ctx.beginPath(); ctx.arc(cx,cy,R,0,Math.PI*2); ctx.fill();
    ctx.beginPath(); ctx.arc(cx,cy,r,0,Math.PI*2); ctx.fillStyle='#fff'; ctx.fill();
    return;
  }
  let angle = -Math.PI/2;
  segments.forEach(s => {
    if (!s.value) return;
    const a = (s.value/total)*Math.PI*2;
    ctx.beginPath(); ctx.moveTo(cx,cy);
    ctx.arc(cx,cy,R,angle,angle+a); ctx.closePath();
    ctx.fillStyle = s.color; ctx.fill();
    angle += a;
  });
  ctx.beginPath(); ctx.arc(cx,cy,r,0,Math.PI*2);
  ctx.fillStyle='#fff'; ctx.fill();
  ctx.textAlign='center'; ctx.textBaseline='middle';
  ctx.fillStyle='#0f172a'; ctx.font=`bold 22px system-ui`;
  ctx.fillText(total,cx,cy-8);
  ctx.fillStyle='#94a3b8'; ctx.font=`12px system-ui`;
  ctx.fillText(title||'Total',cx,cy+10);
}

function drawBars(canvasId, labels, values, colors) {
  const canvas = document.getElementById(canvasId);
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const W = canvas.width, H = canvas.height;
  ctx.clearRect(0,0,W,H);
  const max = Math.max(...values, 1);
  const pad = { top:10, right:16, bottom:10, left:80 };
  const bH = Math.floor((H - pad.top - pad.bottom) / labels.length - 6);
  labels.forEach((label, i) => {
    const y = pad.top + i*(bH+6);
    const barW = ((values[i]||0)/max) * (W - pad.left - pad.right);
    ctx.fillStyle = colors[i] || '#2563eb';
    const rx = 3;
    if (barW > 0) {
      ctx.beginPath();
      ctx.moveTo(pad.left + rx, y);
      ctx.lineTo(pad.left + barW - rx, y);
      ctx.quadraticCurveTo(pad.left + barW, y, pad.left + barW, y + rx);
      ctx.lineTo(pad.left + barW, y + bH - rx);
      ctx.quadraticCurveTo(pad.left + barW, y + bH, pad.left + barW - rx, y + bH);
      ctx.lineTo(pad.left + rx, y + bH);
      ctx.quadraticCurveTo(pad.left, y + bH, pad.left, y + bH - rx);
      ctx.lineTo(pad.left, y + rx);
      ctx.quadraticCurveTo(pad.left, y, pad.left + rx, y);
      ctx.closePath();
      ctx.fill();
    }
    ctx.fillStyle = '#475569'; ctx.font = '11px system-ui';
    ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
    ctx.fillText(label, pad.left - 6, y + bH/2);
    if (values[i] > 0) {
      ctx.fillStyle = '#fff'; ctx.textAlign = 'left'; ctx.font = 'bold 11px system-ui';
      ctx.fillText(values[i], pad.left + 6, y + bH/2);
    }
  });
}

// ─── DASHBOARD ───────────────────────────────────────────────
function renderDashboard() {
  const el = document.getElementById('view-dashboard');
  const st = getStats();
  const alerts = getAllAlerts().slice(0,6);

  const kpis = [
    { label:'Total Documentos', value:st.total, sub:'Registrados en el sistema', cls:'accent-blue' },
    { label:'Documentos Vigentes', value:st.ok, sub:'Sin observaciones', cls:'accent-green' },
    { label:'Próximos a Vencer', value:st.warning + st.caution, sub:'En los próximos 60 días', cls:'accent-orange' },
    { label:'Documentos Vencidos', value:st.expired, sub:'Requieren renovación inmediata', cls:'accent-red' },
    { label:'Vehículos Bloqueados', value:st.blockedVehicles, sub:'Con documentación vencida', cls:'accent-red' },
    { label:'Choferes Bloqueados', value:st.blockedDrivers, sub:'No habilitados para operar', cls:'accent-red' },
  ];

  const riskColor = st.riskScore >= 60 ? COLORS.red : st.riskScore >= 30 ? COLORS.orange : COLORS.green;
  const riskLabel = st.riskScore >= 60 ? 'ALTO' : st.riskScore >= 30 ? 'MEDIO' : 'BAJO';

  const alertHtml = alerts.length ? alerts.map(a => {
    const days = a.days;
    const dText = days < 0 ? `Venció hace ${Math.abs(days)} días` : days === 0 ? 'Vence hoy' : `Vence en ${days} días`;
    return `<div class="alert-card ${a.status}">
      <div class="alert-icon ${a.status}">
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M8 2L14.5 13H1.5L8 2Z" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/><path d="M8 6V9" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/><circle cx="8" cy="11.5" r="0.75" fill="currentColor"/></svg>
      </div>
      <div class="alert-info">
        <div class="alert-entity">${escHtml(a.entityName)}</div>
        <div class="alert-doc">${escHtml(a.type)}</div>
      </div>
      <div class="alert-days ${a.status}">${dText}</div>
    </div>`;
  }).join('') : `<div class="empty-state"><div class="empty-state-title">Sin alertas activas</div></div>`;

  el.innerHTML = `
    <div class="page-header">
      <div>
        <div class="page-title">Dashboard Ejecutivo</div>
        <div class="page-subtitle">Resumen operativo · ${new Date().toLocaleDateString('es-AR',{weekday:'long',year:'numeric',month:'long',day:'numeric'})}</div>
      </div>
    </div>

    <div class="kpi-grid">
      ${kpis.map(k => `
        <div class="kpi-card ${k.cls}">
          <div class="kpi-label">${k.label}</div>
          <div class="kpi-value">${k.value}</div>
          <div class="kpi-sub">${k.sub}</div>
        </div>`).join('')}
    </div>

    <div class="charts-grid" style="margin-bottom:20px">
      <div class="chart-card">
        <div class="chart-title">Estado de Documentación</div>
        <div style="display:flex;align-items:center;gap:20px">
          <canvas id="chart-donut" width="140" height="140"></canvas>
          <div class="chart-legend">
            <div class="legend-item"><span class="legend-dot" style="background:${COLORS.red}"></span>Vencidos <strong style="margin-left:auto;min-width:24px;text-align:right">${st.expired}</strong></div>
            <div class="legend-item"><span class="legend-dot" style="background:${COLORS.orange}"></span>Advertencia <strong style="margin-left:auto;min-width:24px;text-align:right">${st.warning}</strong></div>
            <div class="legend-item"><span class="legend-dot" style="background:${COLORS.yellow}"></span>Precaución <strong style="margin-left:auto;min-width:24px;text-align:right">${st.caution}</strong></div>
            <div class="legend-item"><span class="legend-dot" style="background:${COLORS.green}"></span>Vigentes <strong style="margin-left:auto;min-width:24px;text-align:right">${st.ok}</strong></div>
          </div>
        </div>
      </div>
      <div class="chart-card">
        <div class="chart-title">Vencimientos por Categoría</div>
        <canvas id="chart-bars" width="320" height="140"></canvas>
      </div>
    </div>

    <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:20px">
      <div class="risk-summary">
        <div class="risk-title">Indicador de Riesgo Operativo</div>
        <div style="display:flex;align-items:center;gap:16px">
          <div style="flex:1">
            <div style="font-size:32px;font-weight:800;color:${riskColor}">${st.riskScore}<span style="font-size:16px;color:#94a3b8">/100</span></div>
            <div style="font-size:13px;font-weight:600;color:${riskColor};margin-top:2px">Riesgo ${riskLabel}</div>
          </div>
          <div style="flex:2">
            <div class="risk-bars">
              <div class="risk-bar-item"><span class="risk-bar-label" style="color:#ef4444">Vencidos</span><div class="risk-bar-track"><div class="risk-bar-fill" style="width:${st.expired?Math.min(100,(st.expired/st.total)*100):0}%;background:#ef4444"></div></div><span class="risk-bar-count" style="color:#ef4444">${st.expired}</span></div>
              <div class="risk-bar-item"><span class="risk-bar-label" style="color:#f97316">Advertencia</span><div class="risk-bar-track"><div class="risk-bar-fill" style="width:${st.warning?Math.min(100,(st.warning/st.total)*100):0}%;background:#f97316"></div></div><span class="risk-bar-count" style="color:#f97316">${st.warning}</span></div>
              <div class="risk-bar-item"><span class="risk-bar-label" style="color:#f59e0b">Precaución</span><div class="risk-bar-track"><div class="risk-bar-fill" style="width:${st.caution?Math.min(100,(st.caution/st.total)*100):0}%;background:#f59e0b"></div></div><span class="risk-bar-count" style="color:#f59e0b">${st.caution}</span></div>
              <div class="risk-bar-item"><span class="risk-bar-label" style="color:#22c55e">Vigentes</span><div class="risk-bar-track"><div class="risk-bar-fill" style="width:${st.ok?Math.min(100,(st.ok/st.total)*100):0}%;background:#22c55e"></div></div><span class="risk-bar-count" style="color:#22c55e">${st.ok}</span></div>
            </div>
          </div>
        </div>
      </div>
      <div class="risk-summary">
        <div class="risk-title">Estado de Flota y Operadores</div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-top:8px">
          <div style="text-align:center;padding:12px;background:#f8fafc;border-radius:8px">
            <div style="font-size:28px;font-weight:800;color:#0f172a">${State.vehicles.length}</div>
            <div style="font-size:11px;color:#94a3b8;text-transform:uppercase;letter-spacing:.05em">Vehículos</div>
            <div style="font-size:12px;color:#ef4444;font-weight:600;margin-top:4px">${st.blockedVehicles} bloqueados</div>
          </div>
          <div style="text-align:center;padding:12px;background:#f8fafc;border-radius:8px">
            <div style="font-size:28px;font-weight:800;color:#0f172a">${State.drivers.length}</div>
            <div style="font-size:11px;color:#94a3b8;text-transform:uppercase;letter-spacing:.05em">Choferes</div>
            <div style="font-size:12px;color:#ef4444;font-weight:600;margin-top:4px">${st.blockedDrivers} no habilitados</div>
          </div>
          <div style="text-align:center;padding:12px;background:#f8fafc;border-radius:8px">
            <div style="font-size:28px;font-weight:800;color:#22c55e">${State.vehicles.length - st.blockedVehicles}</div>
            <div style="font-size:11px;color:#94a3b8;text-transform:uppercase;letter-spacing:.05em">Operativos</div>
          </div>
          <div style="text-align:center;padding:12px;background:#f8fafc;border-radius:8px">
            <div style="font-size:28px;font-weight:800;color:#22c55e">${State.drivers.length - st.blockedDrivers}</div>
            <div style="font-size:11px;color:#94a3b8;text-transform:uppercase;letter-spacing:.05em">Habilitados</div>
          </div>
        </div>
      </div>
    </div>

    <div class="critical-alerts-section">
      <div class="section-title">
        Alertas Críticas Recientes
        <a class="see-all-link" onclick="navigate('alerts')" style="cursor:pointer">Ver todas las alertas</a>
      </div>
      <div class="alerts-list">${alertHtml}</div>
    </div>`;

  // Draw charts after DOM is ready
  requestAnimationFrame(() => {
    drawDonut('chart-donut', [
      { value: st.expired, color: COLORS.red },
      { value: st.warning, color: COLORS.orange },
      { value: st.caution, color: COLORS.yellow },
      { value: st.ok, color: COLORS.green },
    ], 'docs');

    const catCounts = ['vehicle','driver','company','waste'].map(cat => ({
      label: CATEGORY_LABELS[cat],
      value: State.expirations.filter(e => e.category === cat && getStatus(e.expiryDate) !== 'ok').length,
      color: [COLORS.blue, COLORS.sky, COLORS.orange, COLORS.yellow][['vehicle','driver','company','waste'].indexOf(cat)]
    }));
    drawBars('chart-bars',
      catCounts.map(c=>c.label),
      catCounts.map(c=>c.value),
      catCounts.map(c=>c.color)
    );
  });
}

// ─── ALERTS VIEW ─────────────────────────────────────────────
function renderAlerts() {
  const el = document.getElementById('view-alerts');
  const allAlerts = getAllAlerts();
  const filters = ['all','expired','warning','caution'];
  const labels = { all:'Todas', expired:'Críticas / Vencidas', warning:'Advertencia (30d)', caution:'Precaución (60d)' };
  let activeFilter = 'all';

  function build() {
    const filtered = activeFilter === 'all' ? allAlerts :
      activeFilter === 'expired' ? allAlerts.filter(a => a.status === 'expired' || a.status === 'critical') :
      allAlerts.filter(a => a.status === activeFilter);

    const tabs = filters.map(f => {
      const count = f === 'all' ? allAlerts.length :
        f === 'expired' ? allAlerts.filter(a => a.status==='expired'||a.status==='critical').length :
        allAlerts.filter(a=>a.status===f).length;
      return `<button class="filter-tab ${activeFilter===f?'active':''}" data-filter="${f}">${labels[f]} <span style="margin-left:4px;background:rgba(0,0,0,.08);padding:1px 6px;border-radius:10px;font-size:10px">${count}</span></button>`;
    }).join('');

    const items = filtered.length ? filtered.map(a => {
      const days = a.days;
      const dText = days < 0 ? `Venció hace ${Math.abs(days)} días` : days === 0 ? 'Vence hoy' : `Vence en ${days} días`;
      return `<div class="alert-card ${a.status}">
        <div class="alert-icon ${a.status}">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M8 2L14.5 13H1.5L8 2Z" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/><path d="M8 6V9" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/><circle cx="8" cy="11.5" r="0.75" fill="currentColor"/></svg>
        </div>
        <div class="alert-info">
          <div class="alert-entity">${escHtml(a.entityName)} <span style="font-size:10px;color:#94a3b8;font-weight:400">· ${a.entityType}</span></div>
          <div class="alert-doc">${escHtml(a.type)}</div>
        </div>
        <div>
          <div style="font-size:11px;color:#94a3b8;text-align:right">Vto. ${fmtDate(a.expiryDate)}</div>
          <div class="alert-days ${a.status}" style="text-align:right;margin-top:2px">${dText}</div>
        </div>
      </div>`;
    }).join('') : `<div class="empty-state"><div class="empty-state-title">Sin alertas en esta categoría</div></div>`;

    el.innerHTML = `
      <div class="page-header">
        <div><div class="page-title">Centro de Alertas</div>
        <div class="page-subtitle">${allAlerts.length} alertas activas en el sistema</div></div>
      </div>
      <div class="filter-tabs">${tabs}</div>
      <div class="alerts-list">${items}</div>`;

    el.querySelectorAll('.filter-tab').forEach(btn => {
      btn.addEventListener('click', () => { activeFilter = btn.dataset.filter; build(); });
    });
  }
  build();
}

// ─── VEHICLES VIEW ───────────────────────────────────────────
function renderVehicles() {
  const el = document.getElementById('view-vehicles');
  const blocked = State.vehicles.filter(v => isVehicleBlocked(v.id)).length;
  const alert = State.vehicles.filter(v => getVehicleStatus(v.id)==='alert').length;

  const rows = State.vehicles.map(v => {
    const driverName = v.driverId ? getDriverName(v.driverId) : '—';
    const vExps = State.expirations.filter(e => e.vehicleId === v.id);
    const expired = vExps.filter(e => getStatus(e.expiryDate)==='expired').length;
    const expStatus = vExps.length ? `${vExps.length} doc${expired?` · <span style="color:#ef4444">${expired} vencidos</span>`:''}` : '—';
    return `<tr>
      <td><span class="font-mono" style="font-weight:600;color:#1d4ed8">${escHtml(v.patent)}</span></td>
      <td>${escHtml(v.brand)} <span style="color:#94a3b8">${escHtml(v.model)}</span></td>
      <td>${v.year}</td>
      <td>${escHtml(driverName)}</td>
      <td>${expStatus}</td>
      <td>${vehicleStatusBadge(v.id)}</td>
      <td>
        <div class="action-btns">
          <button class="btn-icon" title="Editar" onclick="editVehicle('${v.id}')">
            <svg width="15" height="15" viewBox="0 0 15 15" fill="none"><path d="M10.5 1.5L13.5 4.5L5 13H2V10L10.5 1.5Z" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/></svg>
          </button>
          <button class="btn-icon danger" title="Eliminar" onclick="deleteVehicle('${v.id}')">
            <svg width="15" height="15" viewBox="0 0 15 15" fill="none"><path d="M2 4H13M5 4V2.5C5 2 5.5 1.5 6 1.5H9C9.5 1.5 10 2 10 2.5V4M6 7V11M9 7V11M3 4L4 13H11L12 4" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg>
          </button>
        </div>
      </td>
    </tr>`;
  }).join('');

  el.innerHTML = `
    <div class="page-header">
      <div><div class="page-title">Gestión de Vehículos</div>
      <div class="page-subtitle">Control de flota y documentación vehicular</div></div>
      <div class="page-actions">
        <button class="btn-primary" onclick="addVehicle()">
          <svg width="15" height="15" viewBox="0 0 15 15" fill="none"><path d="M7.5 2V13M2 7.5H13" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
          Agregar Vehículo
        </button>
      </div>
    </div>
    <div class="stats-bar">
      <div class="stat-pill blue"><span class="stat-num">${State.vehicles.length}</span><span class="stat-label">Total flota</span></div>
      <div class="stat-pill green"><span class="stat-num">${State.vehicles.length-blocked-alert}</span><span class="stat-label">Operativos</span></div>
      <div class="stat-pill orange"><span class="stat-num">${alert}</span><span class="stat-label">Con alertas</span></div>
      <div class="stat-pill red"><span class="stat-num">${blocked}</span><span class="stat-label">Bloqueados</span></div>
    </div>
    <div class="table-wrapper">
      <table>
        <thead><tr>
          <th>Patente</th><th>Marca / Modelo</th><th>Año</th>
          <th>Chofer Asignado</th><th>Documentos</th><th>Estado</th><th>Acciones</th>
        </tr></thead>
        <tbody>${rows || '<tr><td colspan="7" style="text-align:center;padding:40px;color:#94a3b8">Sin vehículos registrados</td></tr>'}</tbody>
      </table>
    </div>`;
}

function addVehicle() {
  State.editingId = null;
  openModal('Nuevo Vehículo', vehicleFormHtml(null), saveVehicle);
}
function editVehicle(id) {
  State.editingId = id;
  const v = State.vehicles.find(v=>v.id===id);
  openModal('Editar Vehículo', vehicleFormHtml(v), saveVehicle);
}
function vehicleFormHtml(v={}) {
  const driverOpts = `<option value="">— Sin asignar —</option>` +
    State.drivers.map(d => `<option value="${d.id}" ${(v&&v.driverId===d.id)?'selected':''}>${escHtml(d.name+' '+d.lastName)}</option>`).join('');
  return `<div class="form-grid">
    <div class="form-group"><label class="form-label">Patente <span style="color:red">*</span></label>
      <input class="form-control" id="f-patent" value="${escHtml(v?.patent||'')}" placeholder="AB 123 CD" style="text-transform:uppercase"></div>
    <div class="form-group"><label class="form-label">Marca <span style="color:red">*</span></label>
      <input class="form-control" id="f-brand" value="${escHtml(v?.brand||'')}" placeholder="Mercedes-Benz"></div>
    <div class="form-group"><label class="form-label">Modelo <span style="color:red">*</span></label>
      <input class="form-control" id="f-model" value="${escHtml(v?.model||'')}" placeholder="Actros 2651"></div>
    <div class="form-group"><label class="form-label">Año</label>
      <input class="form-control" id="f-year" type="number" value="${v?.year||new Date().getFullYear()}" min="1990" max="2030"></div>
    <div class="form-group full"><label class="form-label">Chofer Asignado</label>
      <select class="form-control" id="f-driverId">${driverOpts}</select></div>
    <div class="form-group full"><label class="form-label">Observaciones</label>
      <textarea class="form-control" id="f-notes" rows="2">${escHtml(v?.notes||'')}</textarea></div>
  </div>`;
}
function saveVehicle() {
  const patent = document.getElementById('f-patent').value.trim().toUpperCase();
  const brand = document.getElementById('f-brand').value.trim();
  const model = document.getElementById('f-model').value.trim();
  if (!patent || !brand || !model) { toast('Complete los campos obligatorios','error'); return; }
  const data = { patent, brand, model, year: parseInt(document.getElementById('f-year').value)||new Date().getFullYear(), driverId: document.getElementById('f-driverId').value||null, notes: document.getElementById('f-notes').value.trim() };
  if (State.editingId) {
    const i = State.vehicles.findIndex(v=>v.id===State.editingId);
    if (i>=0) { State.vehicles[i] = {...State.vehicles[i],...data}; logHistory('update','vehicle',State.editingId,patent,`Vehículo ${patent} actualizado`); }
    toast('Vehículo actualizado');
  } else {
    const v = { id:genId(), ...data };
    State.vehicles.push(v); logHistory('create','vehicle',v.id,patent,`Vehículo ${patent} registrado`);
    toast('Vehículo agregado correctamente');
  }
  DB.save('vehicles',State.vehicles);
  closeModal(); renderVehicles(); updateBadges();
}
function deleteVehicle(id) {
  const v = State.vehicles.find(v=>v.id===id);
  if (!confirm(`¿Eliminar el vehículo ${v?.patent}? Esta acción no se puede deshacer.`)) return;
  State.vehicles = State.vehicles.filter(v=>v.id!==id);
  State.expirations = State.expirations.filter(e=>e.vehicleId!==id);
  logHistory('delete','vehicle',id,v?.patent||id,`Vehículo ${v?.patent} eliminado`);
  DB.save('vehicles',State.vehicles); DB.save('expirations',State.expirations);
  toast('Vehículo eliminado','warning'); renderVehicles(); updateBadges();
}

// ─── DRIVERS VIEW ────────────────────────────────────────────
function renderDrivers() {
  const el = document.getElementById('view-drivers');
  const blocked = State.drivers.filter(d=>isDriverBlocked(d.id)).length;
  const warn = State.drivers.filter(d=>getDriverStatus(d.id)==='warning').length;

  const rows = State.drivers.map(d => {
    const licExp = State.expirations.find(e=>e.driverId===d.id&&e.type==='Licencia de Conducir');
    const psiExp = State.expirations.find(e=>e.driverId===d.id&&e.type==='Psicofísico');
    const artExp = State.expirations.find(e=>e.driverId===d.id&&e.type==='ART');
    return `<tr>
      <td><div style="font-weight:600">${escHtml(d.name+' '+d.lastName)}</div></td>
      <td class="td-secondary">${escHtml(d.dni)}</td>
      <td><span class="badge badge-info">Cat. ${escHtml(d.licenseCategory)}</span></td>
      <td>${licExp ? `<span style="font-size:12px;color:${getStatus(licExp.expiryDate)==='ok'?'#22c55e':'#ef4444'}">${fmtDate(licExp.expiryDate)}</span>` : '<span style="color:#94a3b8">—</span>'}</td>
      <td>${psiExp ? `<span style="font-size:12px;color:${getStatus(psiExp.expiryDate)==='ok'?'#22c55e':'#ef4444'}">${fmtDate(psiExp.expiryDate)}</span>` : '<span style="color:#94a3b8">—</span>'}</td>
      <td>${artExp ? `<span style="font-size:12px;color:${getStatus(artExp.expiryDate)==='ok'?'#22c55e':'#ef4444'}">${fmtDate(artExp.expiryDate)}</span>` : '<span style="color:#94a3b8">—</span>'}</td>
      <td>${driverStatusBadge(d.id)}</td>
      <td>
        <div class="action-btns">
          <button class="btn-icon" title="Editar" onclick="editDriver('${d.id}')">
            <svg width="15" height="15" viewBox="0 0 15 15" fill="none"><path d="M10.5 1.5L13.5 4.5L5 13H2V10L10.5 1.5Z" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/></svg>
          </button>
          <button class="btn-icon danger" title="Eliminar" onclick="deleteDriver('${d.id}')">
            <svg width="15" height="15" viewBox="0 0 15 15" fill="none"><path d="M2 4H13M5 4V2.5C5 2 5.5 1.5 6 1.5H9C9.5 1.5 10 2 10 2.5V4M6 7V11M9 7V11M3 4L4 13H11L12 4" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg>
          </button>
        </div>
      </td>
    </tr>`;
  }).join('');

  el.innerHTML = `
    <div class="page-header">
      <div><div class="page-title">Gestión de Choferes</div>
      <div class="page-subtitle">Control de habilitaciones y documentación de conductores</div></div>
      <div class="page-actions">
        <button class="btn-primary" onclick="addDriver()">
          <svg width="15" height="15" viewBox="0 0 15 15" fill="none"><path d="M7.5 2V13M2 7.5H13" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
          Agregar Chofer
        </button>
      </div>
    </div>
    <div class="stats-bar">
      <div class="stat-pill blue"><span class="stat-num">${State.drivers.length}</span><span class="stat-label">Total choferes</span></div>
      <div class="stat-pill green"><span class="stat-num">${State.drivers.length-blocked-warn}</span><span class="stat-label">Habilitados</span></div>
      <div class="stat-pill orange"><span class="stat-num">${warn}</span><span class="stat-label">Prox. a vencer</span></div>
      <div class="stat-pill red"><span class="stat-num">${blocked}</span><span class="stat-label">No habilitados</span></div>
    </div>
    <div class="table-wrapper">
      <table>
        <thead><tr>
          <th>Nombre Completo</th><th>DNI</th><th>Categoría</th>
          <th>Vto. Licencia</th><th>Vto. Psicofísico</th><th>Vto. ART</th><th>Estado</th><th>Acciones</th>
        </tr></thead>
        <tbody>${rows||'<tr><td colspan="8" style="text-align:center;padding:40px;color:#94a3b8">Sin choferes registrados</td></tr>'}</tbody>
      </table>
    </div>`;
}

function addDriver() { State.editingId = null; openModal('Nuevo Chofer', driverFormHtml(null), saveDriver); }
function editDriver(id) { State.editingId = id; openModal('Editar Chofer', driverFormHtml(State.drivers.find(d=>d.id===id)), saveDriver); }
function driverFormHtml(d={}) {
  const cats = ['B','C','D','E','F'];
  return `<div class="form-grid">
    <div class="form-group"><label class="form-label">Nombre <span style="color:red">*</span></label>
      <input class="form-control" id="f-name" value="${escHtml(d?.name||'')}"></div>
    <div class="form-group"><label class="form-label">Apellido <span style="color:red">*</span></label>
      <input class="form-control" id="f-lastName" value="${escHtml(d?.lastName||'')}"></div>
    <div class="form-group"><label class="form-label">DNI</label>
      <input class="form-control" id="f-dni" value="${escHtml(d?.dni||'')}" placeholder="28456789"></div>
    <div class="form-group"><label class="form-label">Nro. Licencia</label>
      <input class="form-control" id="f-licenseNumber" value="${escHtml(d?.licenseNumber||'')}"></div>
    <div class="form-group"><label class="form-label">Categoría</label>
      <select class="form-control" id="f-licenseCategory">
        ${cats.map(c=>`<option value="${c}" ${d?.licenseCategory===c?'selected':''}>${c}</option>`).join('')}
      </select></div>
    <div class="form-group full"><label class="form-label">Observaciones</label>
      <textarea class="form-control" id="f-notes" rows="2">${escHtml(d?.notes||'')}</textarea></div>
  </div>`;
}
function saveDriver() {
  const name = document.getElementById('f-name').value.trim();
  const lastName = document.getElementById('f-lastName').value.trim();
  if (!name || !lastName) { toast('Complete nombre y apellido','error'); return; }
  const data = { name, lastName, dni: document.getElementById('f-dni').value.trim(), licenseNumber: document.getElementById('f-licenseNumber').value.trim(), licenseCategory: document.getElementById('f-licenseCategory').value, notes: document.getElementById('f-notes').value.trim() };
  if (State.editingId) {
    const i = State.drivers.findIndex(d=>d.id===State.editingId);
    if (i>=0) { State.drivers[i] = {...State.drivers[i],...data}; logHistory('update','driver',State.editingId,`${name} ${lastName}`,`Chofer ${name} ${lastName} actualizado`); }
    toast('Chofer actualizado');
  } else {
    const d = { id:genId(),...data };
    State.drivers.push(d); logHistory('create','driver',d.id,`${name} ${lastName}`,`Chofer ${name} ${lastName} registrado`);
    toast('Chofer agregado');
  }
  DB.save('drivers',State.drivers); closeModal(); renderDrivers(); updateBadges();
}
function deleteDriver(id) {
  const d = State.drivers.find(d=>d.id===id);
  if (!confirm(`¿Eliminar al chofer ${d?.name} ${d?.lastName}?`)) return;
  State.drivers = State.drivers.filter(d=>d.id!==id);
  logHistory('delete','driver',id,`${d?.name} ${d?.lastName}`,`Chofer eliminado`);
  DB.save('drivers',State.drivers); toast('Chofer eliminado','warning'); renderDrivers(); updateBadges();
}

// ─── EXPIRATIONS VIEW ────────────────────────────────────────
function renderExpirations() {
  const el = document.getElementById('view-expirations');
  let filterCat = 'all', filterStatus = 'all';

  function build() {
    let exps = State.expirations;
    if (filterCat !== 'all') exps = exps.filter(e=>e.category===filterCat);
    if (filterStatus !== 'all') exps = exps.filter(e=>getStatus(e.expiryDate)===filterStatus);
    exps = [...exps].sort((a,b)=>getDays(a.expiryDate)-getDays(b.expiryDate));

    const rows = exps.map(e => {
      const status = getStatus(e.expiryDate);
      const days = getDays(e.expiryDate);
      const entityName = e.vehicleId ? getVehicleName(e.vehicleId) : e.driverId ? getDriverName(e.driverId) : 'Empresa';
      return `<tr>
        <td style="max-width:200px"><div style="font-weight:500">${escHtml(e.type)}</div></td>
        <td><span class="badge badge-info">${escHtml(CATEGORY_LABELS[e.category]||e.category)}</span></td>
        <td class="td-secondary">${escHtml(entityName)}</td>
        <td class="td-secondary">${fmtDate(e.issueDate)}</td>
        <td style="font-weight:500">${fmtDate(e.expiryDate)}</td>
        <td><span class="badge badge-${status}">${days < 0 ? `${Math.abs(days)} días` : days === 0 ? 'Hoy' : `${days} días`}</span></td>
        <td><span class="badge badge-${status}">${statusLabel(status)}</span></td>
        <td>
          <div class="action-btns">
            <button class="btn-icon" title="Renovar" onclick="renewExpiration('${e.id}')" style="color:#22c55e">
              <svg width="15" height="15" viewBox="0 0 15 15" fill="none"><path d="M2 7.5C2 4.5 4.5 2 7.5 2C9.5 2 11.3 3 12.5 4.5M13 7.5C13 10.5 10.5 13 7.5 13C5.5 13 3.7 12 2.5 10.5" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/><path d="M10 4.5L12.5 4.5L12.5 2" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg>
            </button>
            <button class="btn-icon" title="Editar" onclick="editExpiration('${e.id}')">
              <svg width="15" height="15" viewBox="0 0 15 15" fill="none"><path d="M10.5 1.5L13.5 4.5L5 13H2V10L10.5 1.5Z" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/></svg>
            </button>
            <button class="btn-icon danger" title="Eliminar" onclick="deleteExpiration('${e.id}')">
              <svg width="15" height="15" viewBox="0 0 15 15" fill="none"><path d="M2 4H13M5 4V2.5C5 2 5.5 1.5 6 1.5H9C9.5 1.5 10 2 10 2.5V4M6 7V11M9 7V11M3 4L4 13H11L12 4" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg>
            </button>
          </div>
        </td>
      </tr>`;
    }).join('');

    el.innerHTML = `
      <div class="page-header">
        <div><div class="page-title">Gestión de Vencimientos</div>
        <div class="page-subtitle">${State.expirations.length} documentos registrados</div></div>
        <div class="page-actions">
          <button class="btn-primary" onclick="addExpiration()">
            <svg width="15" height="15" viewBox="0 0 15 15" fill="none"><path d="M7.5 2V13M2 7.5H13" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
            Agregar Vencimiento
          </button>
        </div>
      </div>
      <div class="filter-row">
        <select class="filter-select" id="filt-cat" onchange="expFilterChange()">
          <option value="all">Todas las categorías</option>
          <option value="vehicle">Vehículos</option>
          <option value="driver">Choferes</option>
          <option value="company">Empresa</option>
          <option value="waste">Residuos</option>
        </select>
        <select class="filter-select" id="filt-status" onchange="expFilterChange()">
          <option value="all">Todos los estados</option>
          <option value="expired">Vencidos</option>
          <option value="critical">Críticos (15d)</option>
          <option value="warning">Advertencia (30d)</option>
          <option value="caution">Precaución (60d)</option>
          <option value="ok">Vigentes</option>
        </select>
        <span style="font-size:12px;color:#94a3b8;margin-left:8px">${exps.length} resultado${exps.length!==1?'s':''}</span>
      </div>
      <div class="table-wrapper">
        <table>
          <thead><tr>
            <th>Tipo de Documento</th><th>Categoría</th><th>Entidad</th>
            <th>Emisión</th><th>Vencimiento</th><th>Días Restantes</th><th>Estado</th><th>Acciones</th>
          </tr></thead>
          <tbody>${rows||'<tr><td colspan="8" style="text-align:center;padding:40px;color:#94a3b8">Sin vencimientos registrados</td></tr>'}</tbody>
        </table>
      </div>`;

    document.getElementById('filt-cat').value = filterCat;
    document.getElementById('filt-status').value = filterStatus;
  }

  window.expFilterChange = () => {
    filterCat = document.getElementById('filt-cat').value;
    filterStatus = document.getElementById('filt-status').value;
    build();
  };
  build();
}

function addExpiration() { State.editingId = null; openModal('Nuevo Vencimiento', expirationFormHtml(null), saveExpiration, true); }
function editExpiration(id) { State.editingId = id; openModal('Editar Vencimiento', expirationFormHtml(State.expirations.find(e=>e.id===id)), saveExpiration, true); }
function renewExpiration(id) {
  const e = State.expirations.find(e=>e.id===id);
  if (!e) return;
  const newIssue = toISO(today());
  const daysDiff = getDays(e.expiryDate) - getDays(e.issueDate);
  const duration = Math.max(365, daysDiff || 365);
  const html = `<div class="form-grid cols-1">
    <p style="color:#475569;font-size:13px;margin-bottom:8px">Renovando: <strong>${escHtml(e.type)}</strong></p>
    <div class="form-group"><label class="form-label">Nueva Fecha de Emisión</label>
      <input class="form-control" id="f-newIssue" type="date" value="${newIssue}"></div>
    <div class="form-group"><label class="form-label">Nueva Fecha de Vencimiento <span style="color:red">*</span></label>
      <input class="form-control" id="f-newExpiry" type="date" value="${toISO(addDays(today(),duration))}"></div>
    <div class="form-group"><label class="form-label">Observaciones</label>
      <textarea class="form-control" id="f-obs" rows="2">${escHtml(e.observations||'')}</textarea></div>
  </div>`;
  openModal('Renovar Documento', html, () => {
    const newExpiry = document.getElementById('f-newExpiry').value;
    if (!newExpiry) { toast('Ingrese la nueva fecha de vencimiento','error'); return; }
    const i = State.expirations.findIndex(x=>x.id===id);
    State.expirations[i].issueDate = document.getElementById('f-newIssue').value;
    State.expirations[i].expiryDate = newExpiry;
    State.expirations[i].observations = document.getElementById('f-obs').value;
    logHistory('renew','expiration',id,e.type,`${e.type} renovado — nuevo vto. ${fmtDate(newExpiry)}`);
    DB.save('expirations',State.expirations);
    toast('Documento renovado correctamente'); closeModal(); renderExpirations(); updateBadges();
  });
}

function expirationFormHtml(e={}) {
  const vOpts = `<option value="">— Sin vehículo —</option>` + State.vehicles.map(v=>`<option value="${v.id}" ${e?.vehicleId===v.id?'selected':''}>${escHtml(v.patent)} — ${escHtml(v.brand+' '+v.model)}</option>`).join('');
  const dOpts = `<option value="">— Sin chofer —</option>` + State.drivers.map(d=>`<option value="${d.id}" ${e?.driverId===d.id?'selected':''}>${escHtml(d.name+' '+d.lastName)}</option>`).join('');
  const catOpts = Object.entries(CATEGORY_LABELS).map(([k,v])=>`<option value="${k}" ${e?.category===k?'selected':''}>${v}</option>`).join('');
  return `<div class="form-grid">
    <div class="form-group full"><label class="form-label">Tipo de Documento <span style="color:red">*</span></label>
      <input class="form-control" id="f-type" list="exp-types" value="${escHtml(e?.type||'')}" placeholder="Ej: Seguro RC, VTV, Psicofísico...">
      <datalist id="exp-types">${[...new Set(Object.values(EXPIRATION_TYPES).flat())].map(t=>`<option value="${escHtml(t)}">`).join('')}</datalist></div>
    <div class="form-group"><label class="form-label">Categoría</label>
      <select class="form-control" id="f-category">${catOpts}</select></div>
    <div class="form-group"><label class="form-label">Vehículo asociado</label>
      <select class="form-control" id="f-vehicleId">${vOpts}</select></div>
    <div class="form-group"><label class="form-label">Chofer asociado</label>
      <select class="form-control" id="f-driverId">${dOpts}</select></div>
    <div class="form-group"><label class="form-label">Fecha de Emisión</label>
      <input class="form-control" id="f-issueDate" type="date" value="${e?.issueDate||toISO(today())}"></div>
    <div class="form-group"><label class="form-label">Fecha de Vencimiento <span style="color:red">*</span></label>
      <input class="form-control" id="f-expiryDate" type="date" value="${e?.expiryDate||''}"></div>
    <div class="form-group full"><label class="form-label">Descripción / Observaciones</label>
      <textarea class="form-control" id="f-observations" rows="2">${escHtml(e?.observations||'')}</textarea></div>
  </div>`;
}
function saveExpiration() {
  const type = document.getElementById('f-type').value.trim();
  const expiryDate = document.getElementById('f-expiryDate').value;
  if (!type || !expiryDate) { toast('Complete tipo y fecha de vencimiento','error'); return; }
  const data = { type, category: document.getElementById('f-category').value, vehicleId: document.getElementById('f-vehicleId').value||null, driverId: document.getElementById('f-driverId').value||null, issueDate: document.getElementById('f-issueDate').value, expiryDate, observations: document.getElementById('f-observations').value.trim() };
  if (State.editingId) {
    const i = State.expirations.findIndex(e=>e.id===State.editingId);
    if (i>=0) { State.expirations[i]={...State.expirations[i],...data}; logHistory('update','expiration',State.editingId,type,`${type} actualizado`); }
    toast('Vencimiento actualizado');
  } else {
    const e={id:genId(),...data};
    State.expirations.push(e); logHistory('create','expiration',e.id,type,`${type} registrado — vto. ${fmtDate(expiryDate)}`);
    toast('Vencimiento registrado');
  }
  DB.save('expirations',State.expirations); closeModal(); renderExpirations(); updateBadges();
}
function deleteExpiration(id) {
  const e = State.expirations.find(e=>e.id===id);
  if (!confirm(`¿Eliminar el vencimiento "${e?.type}"?`)) return;
  State.expirations = State.expirations.filter(e=>e.id!==id);
  logHistory('delete','expiration',id,e?.type||id,`Vencimiento ${e?.type} eliminado`);
  DB.save('expirations',State.expirations); toast('Vencimiento eliminado','warning'); renderExpirations(); updateBadges();
}

// ─── HAZARDOUS VIEW ──────────────────────────────────────────
function renderHazardous() {
  const el = document.getElementById('view-hazardous');
  const rows = State.hazardous.map(h => {
    const status = getStatus(h.expiryDate);
    const days = getDays(h.expiryDate);
    return `<tr>
      <td><div style="font-weight:500">${escHtml(h.type)}</div></td>
      <td>${escHtml(h.entityName)}</td>
      <td class="td-secondary font-mono">${escHtml(h.permitNumber||'—')}</td>
      <td class="td-secondary">${escHtml(h.issuingAuthority||'—')}</td>
      <td>${fmtDate(h.issueDate)}</td>
      <td style="font-weight:500">${fmtDate(h.expiryDate)}</td>
      <td><span class="badge badge-${status}">${days<0?`${Math.abs(days)}d vencido`:days===0?'Hoy':`${days}d`}</span></td>
      <td><span class="badge badge-${status}">${statusLabel(status)}</span></td>
      <td>
        <div class="action-btns">
          <button class="btn-icon" title="Editar" onclick="editHazardous('${h.id}')">
            <svg width="15" height="15" viewBox="0 0 15 15" fill="none"><path d="M10.5 1.5L13.5 4.5L5 13H2V10L10.5 1.5Z" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/></svg>
          </button>
          <button class="btn-icon danger" title="Eliminar" onclick="deleteHazardous('${h.id}')">
            <svg width="15" height="15" viewBox="0 0 15 15" fill="none"><path d="M2 4H13M5 4V2.5C5 2 5.5 1.5 6 1.5H9C9.5 1.5 10 2 10 2.5V4M6 7V11M9 7V11M3 4L4 13H11L12 4" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg>
          </button>
        </div>
      </td>
    </tr>`;
  }).join('');

  el.innerHTML = `
    <div class="page-header">
      <div><div class="page-title">Residuos Peligrosos</div>
      <div class="page-subtitle">Control normativo, habilitaciones ambientales y permisos regulatorios</div></div>
      <div class="page-actions">
        <button class="btn-primary" onclick="addHazardous()">
          <svg width="15" height="15" viewBox="0 0 15 15" fill="none"><path d="M7.5 2V13M2 7.5H13" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
          Agregar Registro
        </button>
      </div>
    </div>
    <div class="hazardous-info">
      Modulo regulatorio: controle habilitaciones ambientales, permisos de transporte de residuos especiales y peligrosos, polizas ambientales y certificaciones regulatorias vigentes. El sistema alerta automaticamente ante riesgo de incumplimiento.
    </div>
    <div class="table-wrapper">
      <table>
        <thead><tr>
          <th>Tipo</th><th>Entidad</th><th>Nro. Permiso</th><th>Autoridad Emis.</th>
          <th>Emisión</th><th>Vencimiento</th><th>Días</th><th>Estado</th><th>Acciones</th>
        </tr></thead>
        <tbody>${rows||'<tr><td colspan="9" style="text-align:center;padding:40px;color:#94a3b8">Sin registros</td></tr>'}</tbody>
      </table>
    </div>`;
}

function addHazardous() { State.editingId=null; openModal('Nuevo Registro de Residuos', hazardousFormHtml(null), saveHazardous); }
function editHazardous(id) { State.editingId=id; openModal('Editar Registro', hazardousFormHtml(State.hazardous.find(h=>h.id===id)), saveHazardous); }
function hazardousFormHtml(h={}) {
  const types = ['Habilitación Ambiental','Permiso de Transporte','Póliza Ambiental','Contrato de Cliente','Certificado Regulatorio','Manifiesto Residuos','Otra Documentación'];
  return `<div class="form-grid">
    <div class="form-group"><label class="form-label">Tipo <span style="color:red">*</span></label>
      <select class="form-control" id="f-type">${types.map(t=>`<option value="${t}" ${h?.type===t?'selected':''}>${t}</option>`).join('')}</select></div>
    <div class="form-group"><label class="form-label">Entidad / Empresa</label>
      <input class="form-control" id="f-entityName" value="${escHtml(h?.entityName||'')}" placeholder="Nombre de la empresa"></div>
    <div class="form-group"><label class="form-label">Nro. de Permiso</label>
      <input class="form-control" id="f-permitNumber" value="${escHtml(h?.permitNumber||'')}" placeholder="HA-2024-001"></div>
    <div class="form-group"><label class="form-label">Autoridad Emisora</label>
      <input class="form-control" id="f-issuingAuthority" value="${escHtml(h?.issuingAuthority||'')}" placeholder="Ministerio de Ambiente"></div>
    <div class="form-group"><label class="form-label">Fecha de Emisión</label>
      <input class="form-control" id="f-issueDate" type="date" value="${h?.issueDate||toISO(today())}"></div>
    <div class="form-group"><label class="form-label">Fecha de Vencimiento <span style="color:red">*</span></label>
      <input class="form-control" id="f-expiryDate" type="date" value="${h?.expiryDate||''}"></div>
    <div class="form-group full"><label class="form-label">Observaciones</label>
      <textarea class="form-control" id="f-observations" rows="2">${escHtml(h?.observations||'')}</textarea></div>
  </div>`;
}
function saveHazardous() {
  const type = document.getElementById('f-type').value;
  const expiryDate = document.getElementById('f-expiryDate').value;
  if (!expiryDate) { toast('Ingrese la fecha de vencimiento','error'); return; }
  const data = { type, entityName: document.getElementById('f-entityName').value.trim(), permitNumber: document.getElementById('f-permitNumber').value.trim(), issuingAuthority: document.getElementById('f-issuingAuthority').value.trim(), issueDate: document.getElementById('f-issueDate').value, expiryDate, observations: document.getElementById('f-observations').value.trim() };
  if (State.editingId) {
    const i = State.hazardous.findIndex(h=>h.id===State.editingId);
    if (i>=0) { State.hazardous[i]={...State.hazardous[i],...data}; logHistory('update','hazardous',State.editingId,type,`${type} actualizado`); }
    toast('Registro actualizado');
  } else {
    const h={id:genId(),...data};
    State.hazardous.push(h); logHistory('create','hazardous',h.id,type,`${type} registrado`);
    toast('Registro agregado');
  }
  DB.save('hazardous',State.hazardous); closeModal(); renderHazardous(); updateBadges();
}
function deleteHazardous(id) {
  const h = State.hazardous.find(h=>h.id===id);
  if (!confirm(`¿Eliminar "${h?.type}"?`)) return;
  State.hazardous = State.hazardous.filter(h=>h.id!==id);
  logHistory('delete','hazardous',id,h?.type||id,`Registro ${h?.type} eliminado`);
  DB.save('hazardous',State.hazardous); toast('Registro eliminado','warning'); renderHazardous();
}

// ─── CALENDAR VIEW ───────────────────────────────────────────
function renderCalendar() {
  const el = document.getElementById('view-calendar');
  const d = State.calendarDate;
  const year = d.getFullYear(), month = d.getMonth();
  const monthNames = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];
  const dayNames = ['Dom','Lun','Mar','Mié','Jue','Vie','Sáb'];

  const firstDay = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month+1, 0).getDate();
  const daysInPrev = new Date(year, month, 0).getDate();
  const todayStr = toISO(today());

  const allExps = [
    ...State.expirations.map(e => ({ date: e.expiryDate, title: e.type, status: getStatus(e.expiryDate) })),
    ...State.hazardous.map(h => ({ date: h.expiryDate, title: h.type, status: getStatus(h.expiryDate) }))
  ];

  const getDayExps = (y,m,day) => {
    const iso = `${y}-${String(m+1).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
    return allExps.filter(e => e.date === iso);
  };

  let cells = '';
  // Previous month days
  for (let i = firstDay - 1; i >= 0; i--) {
    cells += `<div class="calendar-day other-month"><div class="day-num">${daysInPrev-i}</div></div>`;
  }
  // Current month
  for (let day = 1; day <= daysInMonth; day++) {
    const iso = `${year}-${String(month+1).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
    const isToday = iso === todayStr;
    const dayExps = getDayExps(year,month,day);
    const eventsHtml = dayExps.slice(0,3).map(e =>
      `<div class="day-event ${e.status}" title="${escHtml(e.title)}">${escHtml(e.title)}</div>`
    ).join('') + (dayExps.length > 3 ? `<div style="font-size:10px;color:#94a3b8;padding:1px 4px">+${dayExps.length-3} más</div>` : '');
    cells += `<div class="calendar-day ${isToday?'today':''}">
      <div class="day-num">${day}</div>
      <div class="day-events">${eventsHtml}</div>
    </div>`;
  }
  // Fill remainder
  const totalCells = Math.ceil((firstDay + daysInMonth) / 7) * 7;
  for (let i = 1; i <= totalCells - firstDay - daysInMonth; i++) {
    cells += `<div class="calendar-day other-month"><div class="day-num">${i}</div></div>`;
  }

  el.innerHTML = `
    <div class="page-header">
      <div><div class="page-title">Calendario de Vencimientos</div>
      <div class="page-subtitle">Vista mensual de todos los vencimientos</div></div>
    </div>
    <div class="calendar-wrapper">
      <div class="calendar-header">
        <button class="calendar-nav-btn btn-ghost btn-sm" onclick="calNav(-1)">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M10 12L6 8L10 4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>
          Anterior
        </button>
        <span class="calendar-month-title">${monthNames[month]} ${year}</span>
        <button class="calendar-nav-btn btn-ghost btn-sm" onclick="calNav(1)">
          Siguiente
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M6 12L10 8L6 4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>
        </button>
      </div>
      <div class="calendar-grid">
        ${dayNames.map(d=>`<div class="calendar-day-header">${d}</div>`).join('')}
        ${cells}
      </div>
    </div>`;
}

window.calNav = (dir) => {
  const d = State.calendarDate;
  State.calendarDate = new Date(d.getFullYear(), d.getMonth() + dir, 1);
  renderCalendar();
};

// ─── REPORTS VIEW ────────────────────────────────────────────
function renderReports() {
  const el = document.getElementById('view-reports');
  el.innerHTML = `
    <div class="page-header">
      <div><div class="page-title">Reportes</div>
      <div class="page-subtitle">Generación y exportación de informes operativos</div></div>
    </div>
    <div class="report-section">
      <div class="report-controls">
        <select class="filter-select" id="report-type" onchange="buildReport()" style="min-width:240px">
          <option value="all-expired">Documentos Vencidos</option>
          <option value="next-30">Próximos 30 días</option>
          <option value="next-60">Próximos 60 días</option>
          <option value="vehicles-alert">Vehículos con Alertas</option>
          <option value="drivers-alert">Choferes con Alertas</option>
          <option value="all">Todos los Vencimientos</option>
        </select>
        <button class="btn-ghost" onclick="exportReport('csv')">
          <svg width="15" height="15" viewBox="0 0 15 15" fill="none"><path d="M2.5 9.5V12.5H12.5V9.5M7.5 2V10M5 7.5L7.5 10L10 7.5" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg>
          Exportar CSV
        </button>
        <button class="btn-primary" onclick="exportReport('excel')">
          <svg width="15" height="15" viewBox="0 0 15 15" fill="none"><path d="M2.5 9.5V12.5H12.5V9.5M7.5 2V10M5 7.5L7.5 10L10 7.5" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg>
          Exportar Excel
        </button>
      </div>
      <div id="report-preview"></div>
    </div>`;
  buildReport();
}

window.buildReport = () => {
  const type = document.getElementById('report-type')?.value || 'all-expired';
  let data = [];
  switch(type) {
    case 'all-expired': data = State.expirations.filter(e=>getStatus(e.expiryDate)==='expired'); break;
    case 'next-30': data = State.expirations.filter(e=>{const d=getDays(e.expiryDate);return d>=0&&d<=30;}); break;
    case 'next-60': data = State.expirations.filter(e=>{const d=getDays(e.expiryDate);return d>=0&&d<=60;}); break;
    case 'vehicles-alert':
      data = State.expirations.filter(e=>e.vehicleId&&['expired','critical','warning'].includes(getStatus(e.expiryDate))); break;
    case 'drivers-alert':
      data = State.expirations.filter(e=>e.driverId&&['expired','critical','warning'].includes(getStatus(e.expiryDate))); break;
    default: data = [...State.expirations];
  }
  data = [...data].sort((a,b)=>getDays(a.expiryDate)-getDays(b.expiryDate));
  State._reportData = data;

  const rows = data.map(e => {
    const status = getStatus(e.expiryDate);
    const days = getDays(e.expiryDate);
    const entity = e.vehicleId ? getVehicleName(e.vehicleId) : e.driverId ? getDriverName(e.driverId) : 'Empresa';
    return `<tr>
      <td>${escHtml(e.type)}</td>
      <td><span class="badge badge-info">${CATEGORY_LABELS[e.category]||e.category}</span></td>
      <td>${escHtml(entity)}</td>
      <td>${fmtDate(e.issueDate)}</td>
      <td>${fmtDate(e.expiryDate)}</td>
      <td><span class="badge badge-${status}">${days<0?`${Math.abs(days)}d vencido`:days===0?'Hoy':`${days}d`}</span></td>
      <td><span class="badge badge-${status}">${statusLabel(status)}</span></td>
    </tr>`;
  }).join('');

  document.getElementById('report-preview').innerHTML = `
    <p style="font-size:12px;color:#94a3b8;margin-bottom:12px">${data.length} registro${data.length!==1?'s':''} encontrado${data.length!==1?'s':''}</p>
    <div class="table-wrapper" style="max-height:400px;overflow-y:auto">
      <table>
        <thead><tr><th>Documento</th><th>Categoría</th><th>Entidad</th><th>Emisión</th><th>Vencimiento</th><th>Días</th><th>Estado</th></tr></thead>
        <tbody>${rows||'<tr><td colspan="7" style="text-align:center;padding:32px;color:#94a3b8">Sin datos para este reporte</td></tr>'}</tbody>
      </table>
    </div>`;
};

window.exportReport = (fmt) => {
  const data = State._reportData || [];
  const headers = ['Tipo Documento','Categoría','Entidad','Emisión','Vencimiento','Días Restantes','Estado'];
  const rows = data.map(e => {
    const days = getDays(e.expiryDate);
    const entity = e.vehicleId ? getVehicleName(e.vehicleId) : e.driverId ? getDriverName(e.driverId) : 'Empresa';
    return [e.type, CATEGORY_LABELS[e.category]||e.category, entity, fmtDate(e.issueDate), fmtDate(e.expiryDate), days<0?`-${Math.abs(days)}`:`${days}`, statusLabel(getStatus(e.expiryDate))];
  });
  const csv = [headers, ...rows].map(r => r.map(c => `"${String(c).replace(/"/g,'""')}"`).join(',')).join('\n');
  const blob = new Blob(['﻿'+csv], {type:'text/csv;charset=utf-8'});
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = `logicontrol-reporte-${toISO(today())}.csv`; a.click();
  URL.revokeObjectURL(url);
  toast(`Reporte exportado (${data.length} registros)`);
};

// ─── HISTORY VIEW ────────────────────────────────────────────
function renderHistory() {
  const el = document.getElementById('view-history');
  const actionLabel = { create:'Alta', update:'Modificación', delete:'Baja', renew:'Renovación' };
  const actionColor = { create:'#22c55e', update:'#2563eb', delete:'#ef4444', renew:'#f59e0b' };
  const rows = State.history.map(h => `
    <div class="history-item">
      <div class="history-icon" style="background:${(actionColor[h.action]||'#2563eb')}22;color:${actionColor[h.action]||'#2563eb'}">
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><circle cx="8" cy="8" r="6" stroke="currentColor" stroke-width="1.4"/><path d="M8 5V8L10 10" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>
      </div>
      <div class="history-content">
        <div class="history-action">${escHtml(h.description||h.entityName)}</div>
        <div class="history-meta">
          <span class="history-type-badge ${h.action}">${actionLabel[h.action]||h.action}</span>
          <span class="history-time">${fmtDatetime(h.timestamp)}</span>
        </div>
      </div>
    </div>`).join('');

  el.innerHTML = `
    <div class="page-header">
      <div><div class="page-title">Historial de Actividad</div>
      <div class="page-subtitle">${State.history.length} registros de actividad</div></div>
    </div>
    <div class="history-list">${rows||'<div class="empty-state"><div class="empty-state-title">Sin actividad registrada</div></div>'}</div>`;
}

// ─── INIT & EVENTS ───────────────────────────────────────────
function init() {
  // Load data
  State.vehicles = DB.load('vehicles');
  State.drivers = DB.load('drivers');
  State.expirations = DB.load('expirations');
  State.hazardous = DB.load('hazardous');
  State.history = DB.load('history');

  // Generate demo data if first run
  generateDemoData();

  // Reload after demo data
  State.vehicles = DB.load('vehicles');
  State.drivers = DB.load('drivers');
  State.expirations = DB.load('expirations');
  State.hazardous = DB.load('hazardous');
  State.history = DB.load('history');

  // Nav links
  document.querySelectorAll('.nav-link').forEach(link => {
    link.addEventListener('click', e => {
      e.preventDefault();
      const view = link.dataset.view;
      if (view) { navigate(view); closeSidebar(); }
    });
  });

  // Hamburger (id="hamburger" in HTML)
  const hamburger = document.getElementById('hamburger');
  if (hamburger) {
    hamburger.addEventListener('click', () => {
      document.getElementById('sidebar').classList.toggle('open');
      document.getElementById('sidebar-overlay')?.classList.toggle('active');
    });
  }

  // Sidebar overlay close
  document.getElementById('sidebar-overlay')?.addEventListener('click', closeSidebar);

  // Modal close — IDs in HTML: modal-close-btn, modal-cancel, modal-save
  document.getElementById('modal-close-btn')?.addEventListener('click', closeModal);
  document.getElementById('modal-cancel')?.addEventListener('click', closeModal);
  document.getElementById('modal-overlay')?.addEventListener('click', e => { if (e.target.id==='modal-overlay') closeModal(); });
  document.getElementById('modal-save')?.addEventListener('click', () => { if (State.modalSaveCallback) State.modalSaveCallback(); });

  // Search — dropdown id is "search-results" in HTML
  const searchInput = document.getElementById('search-input');
  if (searchInput) {
    searchInput.addEventListener('input', e => doSearch(e.target.value));
    searchInput.addEventListener('keydown', e => { if (e.key==='Escape') closeSearch(); });
    document.addEventListener('click', e => { if (!e.target.closest('.search-container')) closeSearch(); });
  }

  // Render initial view
  navigate('dashboard');
}

function closeSidebar() {
  document.getElementById('sidebar')?.classList.remove('open');
  document.getElementById('sidebar-overlay')?.classList.remove('active');
}

// Expose globals for inline handlers
window.navigate = navigate;
window.addVehicle = addVehicle;
window.editVehicle = editVehicle;
window.deleteVehicle = deleteVehicle;
window.addDriver = addDriver;
window.editDriver = editDriver;
window.deleteDriver = deleteDriver;
window.addExpiration = addExpiration;
window.editExpiration = editExpiration;
window.deleteExpiration = deleteExpiration;
window.renewExpiration = renewExpiration;
window.addHazardous = addHazardous;
window.editHazardous = editHazardous;
window.deleteHazardous = deleteHazardous;
window.closeSearch = closeSearch;
window.buildReport = buildReport;
window.exportReport = exportReport;
window.calNav = calNav;
window.expFilterChange = expFilterChange;

document.addEventListener('DOMContentLoaded', init);
