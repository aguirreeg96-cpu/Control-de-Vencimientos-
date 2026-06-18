/* ============================================================
   LOGICONTROL PRO — script.js  (versión funcional completa)
   ============================================================ */

// ─── CONSTANTS ───────────────────────────────────────────────
const KEY = 'lcp3_';
const CATS = { vehicle:'Vehículo', driver:'Chofer', company:'Empresa', waste:'Residuos' };

// ─── STATE ───────────────────────────────────────────────────
var App = {
  vehicles: [], drivers: [], expirations: [], hazardous: [], history: [], auditLogs: [],
  companies: [], adminUsers: [],
  view: 'dashboard',
  calYear: new Date().getFullYear(),
  calMonth: new Date().getMonth(),
  editId: null,
  editType: null,
  modalCb: null,
  expCatFilter: 'all',
  expStatusFilter: 'all',
  vehicleSearch: '',
  driverSearch: '',
  alertTab: 'all',
  reportType: 'expired',
  reportData: [],
  historySearch: '',
  adminTab: 'users'
};

// ─── STORAGE ─────────────────────────────────────────────────
function dbSave(k, v) { try { localStorage.setItem(KEY+k, JSON.stringify(v)); } catch(e){} }
function dbLoad(k) { try { var r=localStorage.getItem(KEY+k); return r?JSON.parse(r):[]; } catch(e){ return []; } }
function dbGet(k,def) { try { var r=localStorage.getItem(KEY+k); return r!==null?JSON.parse(r):def; } catch(e){ return def; } }

function saveAll() {
  dbSave('history', App.history);
}

function loadAll() {
  App.history = dbLoad('history');
}

function loadApiData() {
  return Promise.allSettled([
    apiJson('/vehicles?limit=100'),
    apiJson('/drivers?limit=100'),
    apiJson('/expirations?limit=100'),
    apiJson('/hazardous-documents?limit=100'),
    apiJson('/audit-logs?limit=100')
  ]).then(function(results) {
    if(results[0].status==='fulfilled') App.vehicles = results[0].value.data || [];
    else toast('Error al cargar vehículos','error');
    if(results[1].status==='fulfilled') App.drivers = results[1].value.data || [];
    else toast('Error al cargar choferes','error');
    if(results[2].status==='fulfilled') App.expirations = (results[2].value.data||[]).map(normalizeExpiration);
    else toast('Error al cargar vencimientos','error');
    if(results[3].status==='fulfilled') App.hazardous = (results[3].value.data||[]).map(normalizeHazardous);
    else toast('Error al cargar residuos peligrosos','error');
    if(results[4].status==='fulfilled') App.auditLogs = results[4].value.data || [];
    // audit-logs may fail for USER role — ignored silently
    checkLegacyData();
  });
}

function checkLegacyData() {
  var keys=['lcp3_vehicles','lcp3_drivers','lcp3_expirations','lcp3_hazardous'];
  var hasAny=keys.some(function(k){return localStorage.getItem(k)!==null;});
  if(hasAny) toast('Hay datos locales anteriores que todavía no fueron migrados al servidor.','warning');
}

// ─── UTILITIES ───────────────────────────────────────────────
function uid() { return Date.now().toString(36) + Math.random().toString(36).substr(2,5); }

// Category mapping: frontend (lowercase) ↔ API (uppercase)
function catToApi(c){return {vehicle:'VEHICLE',driver:'DRIVER',company:'COMPANY',waste:'WASTE'}[c]||c.toUpperCase();}
function catFromApi(c){return {VEHICLE:'vehicle',DRIVER:'driver',COMPANY:'company',WASTE:'waste'}[c]||(c||'').toLowerCase();}

// Normalize ISO datetime string to YYYY-MM-DD (backend returns full timestamps)
function normDate(s){if(!s)return null;return typeof s==='string'&&s.length>10?s.substring(0,10):s;}

function normalizeExpiration(e){
  return {id:e.id,type:e.type||'',category:catFromApi(e.category),
    vehicleId:e.vehicleId||null,driverId:e.driverId||null,
    issueDate:normDate(e.issueDate),expiryDate:normDate(e.expiryDate),
    description:e.description||'',observations:e.observations||''};
}

function normalizeHazardous(h){
  return {id:h.id,type:h.type||'',entityName:h.entityName||'',
    permitNumber:h.permitNumber||'',issuingAuthority:h.issuingAuthority||'',
    issueDate:normDate(h.issueDate),expiryDate:normDate(h.expiryDate),
    observations:h.observations||''};
}

function today0() { var d=new Date(); d.setHours(0,0,0,0); return d; }

function dateAdd(d,n) { var r=new Date(d); r.setDate(r.getDate()+n); return r; }

function toISO(d) { return d.toISOString().split('T')[0]; }

function relDate(n) { return toISO(dateAdd(today0(),n)); }

function fmtDate(s) {
  if(!s) return '—';
  var d=new Date(s+'T00:00:00');
  return d.toLocaleDateString('es-AR',{day:'2-digit',month:'2-digit',year:'numeric'});
}

function fmtDT(s) {
  if(!s) return '—';
  return new Date(s).toLocaleString('es-AR',{day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit'});
}

function getDays(iso) {
  if(!iso) return 9999;
  var t=today0(), e=new Date(iso+'T00:00:00');
  return Math.ceil((e-t)/86400000);
}

function getStatus(iso) {
  if(!iso) return 'ok';
  var d=getDays(iso);
  if(d<0) return 'expired';
  if(d<=15) return 'critical';
  if(d<=30) return 'warning';
  if(d<=60) return 'caution';
  return 'ok';
}

function statusLabel(s) {
  return {expired:'VENCIDO',critical:'CRÍTICO (15d)',warning:'VENCE 30d',caution:'VENCE 60d',ok:'VIGENTE'}[s]||s;
}

function statusColor(s) {
  return {expired:'#ef4444',critical:'#ef4444',warning:'#f97316',caution:'#f59e0b',ok:'#22c55e'}[s]||'#94a3b8';
}

function badgeClass(s) {
  return {expired:'badge-expired',critical:'badge-critical',warning:'badge-warning',caution:'badge-caution',ok:'badge-ok'}[s]||'badge-ok';
}

function esc(s) {
  return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function daysText(d) {
  if(d<0) return 'Venció hace '+Math.abs(d)+' días';
  if(d===0) return 'Vence HOY';
  if(d===1) return 'Vence mañana';
  return 'Vence en '+d+' días';
}

function getVehicleName(id) {
  var v=App.vehicles.find(function(x){return x.id===id;});
  return v?v.patent+' ('+v.brand+' '+v.model+')':'—';
}
function getDriverName(id) {
  var d=App.drivers.find(function(x){return x.id===id;});
  return d?d.name+' '+d.lastName:'—';
}
function vehicleStatusStr(vid) {
  var exps=App.expirations.filter(function(e){return e.vehicleId===vid;});
  if(exps.some(function(e){return getStatus(e.expiryDate)==='expired';})) return 'blocked';
  if(exps.some(function(e){var s=getStatus(e.expiryDate);return s==='critical'||s==='warning';})) return 'alert';
  return 'ok';
}
function driverStatusStr(did) {
  var exps=App.expirations.filter(function(e){return e.driverId===did;});
  if(exps.some(function(e){return getStatus(e.expiryDate)==='expired';})) return 'blocked';
  if(exps.some(function(e){var s=getStatus(e.expiryDate);return s==='critical'||s==='warning';})) return 'alert';
  return 'ok';
}

function addHistory(action, type, id, name, desc) {
  App.history.unshift({
    id:uid(), action:action, entityType:type, entityId:id,
    entityName:name, description:desc, timestamp:new Date().toISOString()
  });
  if(App.history.length>300) App.history.length=300;
  dbSave('history', App.history);
}

function getAllAlerts() {
  var alerts=[];
  App.expirations.forEach(function(e) {
    var s=getStatus(e.expiryDate);
    if(s==='ok') return;
    var d=getDays(e.expiryDate);
    var name=e.vehicleId?getVehicleName(e.vehicleId):e.driverId?getDriverName(e.driverId):'Empresa';
    alerts.push({id:e.id,status:s,days:d,type:e.type,entity:name,cat:e.category,date:e.expiryDate});
  });
  App.hazardous.forEach(function(h) {
    var s=getStatus(h.expiryDate);
    if(s==='ok') return;
    var d=getDays(h.expiryDate);
    alerts.push({id:h.id,status:s,days:d,type:h.type,entity:h.entityName,cat:'waste',date:h.expiryDate});
  });
  var order={expired:0,critical:1,warning:2,caution:3};
  alerts.sort(function(a,b){ return (order[a.status]||9)-(order[b.status]||9)||a.days-b.days; });
  return alerts;
}

// ─── NAVIGATION ──────────────────────────────────────────────
function navigate(view) {
  App.view=view;
  document.querySelectorAll('.view').forEach(function(el){ el.classList.remove('active'); });
  var el=document.getElementById('view-'+view);
  if(el) el.classList.add('active');
  document.querySelectorAll('.nav-link').forEach(function(l){
    l.classList.toggle('active', l.getAttribute('data-view')===view);
  });
  closeSidebar();
  if (view === 'admin') {
    loadAdminData().then(function(){ renderView(view); });
  } else {
    renderView(view);
  }
  updateBadges();
}

function renderView(v) {
  var map={dashboard:renderDashboard,alerts:renderAlerts,vehicles:renderVehicles,
    drivers:renderDrivers,expirations:renderExpirations,hazardous:renderHazardous,
    calendar:renderCalendar,reports:renderReports,history:renderHistory,admin:renderAdmin};
  if(map[v]) map[v]();
}

function updateBadges() {
  var alerts=getAllAlerts();
  var critical=alerts.filter(function(a){return a.status==='expired'||a.status==='critical';}).length;
  var blockedV=App.vehicles.filter(function(v){return vehicleStatusStr(v.id)==='blocked';}).length;
  var blockedD=App.drivers.filter(function(d){return driverStatusStr(d.id)==='blocked';}).length;
  setBadge('badge-alerts',critical);
  setBadge('badge-vehicles',blockedV);
  setBadge('badge-drivers',blockedD);
  var nd=document.getElementById('notif-dot');
  if(nd) nd.style.display=critical>0?'block':'none';
}

function setBadge(id,n) {
  var el=document.getElementById(id);
  if(!el) return;
  el.textContent=n;
  el.style.display=n>0?'inline-flex':'none';
}

function closeSidebar() {
  var s=document.getElementById('sidebar');
  var o=document.getElementById('sidebar-overlay');
  if(s) s.classList.remove('open');
  if(o) o.classList.remove('active');
}

// ─── TOAST ───────────────────────────────────────────────────
function toast(msg, type) {
  type=type||'success';
  var c=document.getElementById('toast-container');
  if(!c) return;
  var t=document.createElement('div');
  t.className='toast '+type;
  t.textContent=msg;
  c.appendChild(t);
  setTimeout(function(){ t.classList.add('removing'); setTimeout(function(){ if(t.parentNode) t.parentNode.removeChild(t); },300); },3500);
}

// ─── MODAL ───────────────────────────────────────────────────
function openModal(title, html, onSave) {
  var o=document.getElementById('modal-overlay');
  var ti=document.getElementById('modal-title');
  var b=document.getElementById('modal-body');
  if(!o||!ti||!b) return;
  ti.textContent=title;
  b.innerHTML=html;
  o.style.display='flex';
  App.modalCb=onSave||null;
}

function closeModal() {
  var o=document.getElementById('modal-overlay');
  if(o) o.style.display='none';
  App.modalCb=null;
  App.editId=null;
}

// ─── CHARTS ──────────────────────────────────────────────────
function drawDonut(id, segs) {
  var canvas=document.getElementById(id);
  if(!canvas) return;
  var ctx=canvas.getContext('2d');
  var W=canvas.width, H=canvas.height, cx=W/2, cy=H/2, R=Math.min(cx,cy)-8, r=R*0.58;
  ctx.clearRect(0,0,W,H);
  var total=segs.reduce(function(s,x){return s+x.v;},0);
  if(!total) {
    ctx.beginPath(); ctx.arc(cx,cy,R,0,2*Math.PI); ctx.fillStyle='#e2e8f0'; ctx.fill();
    ctx.beginPath(); ctx.arc(cx,cy,r,0,2*Math.PI); ctx.fillStyle='#fff'; ctx.fill();
    return;
  }
  var angle=-Math.PI/2;
  segs.forEach(function(s) {
    if(!s.v) return;
    var a=(s.v/total)*2*Math.PI;
    ctx.beginPath(); ctx.moveTo(cx,cy); ctx.arc(cx,cy,R,angle,angle+a); ctx.closePath();
    ctx.fillStyle=s.c; ctx.fill();
    angle+=a;
  });
  ctx.beginPath(); ctx.arc(cx,cy,r,0,2*Math.PI); ctx.fillStyle='#fff'; ctx.fill();
  ctx.textAlign='center'; ctx.textBaseline='middle';
  ctx.font='bold 20px system-ui'; ctx.fillStyle='#0f172a'; ctx.fillText(total,cx,cy-7);
  ctx.font='11px system-ui'; ctx.fillStyle='#94a3b8'; ctx.fillText('total',cx,cy+9);
}

function drawBars(id, rows) {
  var canvas=document.getElementById(id);
  if(!canvas) return;
  var ctx=canvas.getContext('2d');
  var W=canvas.width, H=canvas.height;
  ctx.clearRect(0,0,W,H);
  if(!rows||!rows.length) return;
  var max=Math.max.apply(null,rows.map(function(r){return r.v;}));
  if(!max) return;
  var padL=90, padR=16, padT=6, gap=6;
  var bH=Math.floor((H-padT-gap*(rows.length-1))/rows.length);
  rows.forEach(function(row,i) {
    var y=padT+i*(bH+gap);
    var bW=((row.v||0)/max)*(W-padL-padR);
    if(bW>0) {
      ctx.fillStyle=row.c||'#2563eb';
      ctx.beginPath();
      ctx.roundRect(padL,y,bW,bH,3);
      ctx.fill();
    }
    ctx.fillStyle='#475569'; ctx.font='11px system-ui'; ctx.textAlign='right'; ctx.textBaseline='middle';
    ctx.fillText(row.l,padL-5,y+bH/2);
    if(row.v>0) {
      ctx.fillStyle=bW>24?'#fff':'#0f172a';
      ctx.textAlign='left'; ctx.font='bold 11px system-ui';
      ctx.fillText(row.v,padL+5,y+bH/2);
    }
  });
}

// ─── DASHBOARD ───────────────────────────────────────────────
function renderDashboard() {
  var el=document.getElementById('view-dashboard');
  if(!el) return;
  var alerts=getAllAlerts();
  var total=App.expirations.length+App.hazardous.length;
  var expired=alerts.filter(function(a){return a.status==='expired';}).length;
  var warn=alerts.filter(function(a){return a.status==='critical'||a.status==='warning';}).length;
  var ok=App.expirations.filter(function(e){return getStatus(e.expiryDate)==='ok';}).length;
  var blV=App.vehicles.filter(function(v){return vehicleStatusStr(v.id)==='blocked';}).length;
  var blD=App.drivers.filter(function(d){return driverStatusStr(d.id)==='blocked';}).length;
  var top5=alerts.slice(0,6);
  var riskScore=total>0?Math.min(99,Math.round((expired*3+warn*2)/total*40)):0;
  var riskColor=riskScore>=60?'#ef4444':riskScore>=30?'#f97316':'#22c55e';
  var riskLbl=riskScore>=60?'ALTO':riskScore>=30?'MEDIO':'BAJO';
  var dateStr=new Date().toLocaleDateString('es-AR',{weekday:'long',year:'numeric',month:'long',day:'numeric'});

  var alertCards=top5.length?top5.map(function(a){
    var d=a.days, dt=d<0?'Venció hace '+Math.abs(d)+'d':d===0?'Vence HOY':'Vence en '+d+'d';
    return '<div class="alert-card '+a.status+'"><div class="alert-icon '+a.status+'">'+warnIcon()+'</div>'+
      '<div class="alert-info"><div class="alert-entity">'+esc(a.entity)+'</div><div class="alert-doc">'+esc(a.type)+'</div></div>'+
      '<div class="alert-days '+a.status+'">'+dt+'</div></div>';
  }).join(''):'<div class="empty-state"><div class="empty-state-title">Sin alertas críticas</div><div class="empty-state-desc">Toda la documentación está en regla</div></div>';

  var expiredN=App.expirations.filter(function(e){return getStatus(e.expiryDate)==='expired';}).length;
  var critN=App.expirations.filter(function(e){return getStatus(e.expiryDate)==='critical';}).length;
  var warnN=App.expirations.filter(function(e){return getStatus(e.expiryDate)==='warning';}).length;
  var cautN=App.expirations.filter(function(e){return getStatus(e.expiryDate)==='caution';}).length;
  var okN=App.expirations.filter(function(e){return getStatus(e.expiryDate)==='ok';}).length;
  var totN=App.expirations.length||1;

  el.innerHTML=
    '<div class="page-header"><div><div class="page-title">Dashboard Ejecutivo</div>'+
    '<div class="page-subtitle">'+esc(dateStr)+'</div></div></div>'+

    '<div class="kpi-grid">'+
    kpi('Total Documentos',total,'Registrados en el sistema','accent-blue')+
    kpi('Documentos Vigentes',ok,'Sin observaciones','accent-green')+
    kpi('Próximos a Vencer (30d)',warn,'Requieren atención','accent-orange')+
    kpi('Vencidos',expired,'Acción inmediata requerida','accent-red')+
    kpi('Vehículos Bloqueados',blV,'Con documentación vencida','accent-red')+
    kpi('Choferes Bloqueados',blD,'No habilitados','accent-yellow')+
    '</div>'+

    '<div class="charts-grid">'+
    '<div class="chart-card"><div class="chart-title">Estado de Documentación</div>'+
    '<div style="display:flex;align-items:center;gap:20px;flex-wrap:wrap">'+
    '<canvas id="ch-donut" width="160" height="160" style="flex-shrink:0"></canvas>'+
    '<div>'+
    '<div style="display:flex;flex-direction:column;gap:7px">'+
    ldot('#ef4444','Vencidos',expiredN)+
    ldot('#f97316','Críticos',critN)+
    ldot('#f59e0b','Advertencia',warnN)+
    ldot('#38bdf8','Precaución',cautN)+
    ldot('#22c55e','Vigentes',okN)+
    '</div></div></div></div>'+
    '<div class="chart-card"><div class="chart-title">Vencimientos por Categoría</div>'+
    '<canvas id="ch-bars" width="340" height="160"></canvas></div>'+
    '</div>'+

    '<div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:20px">'+
    '<div class="risk-summary"><div class="risk-title">Riesgo Operativo</div>'+
    '<div style="display:flex;align-items:center;gap:20px;margin-top:12px">'+
    '<div style="text-align:center"><div style="font-size:42px;font-weight:800;color:'+riskColor+'">'+riskScore+'</div>'+
    '<div style="font-size:13px;font-weight:700;color:'+riskColor+'">Riesgo '+riskLbl+'</div></div>'+
    '<div style="flex:1"><div class="risk-bars">'+
    rBar('Vencidos',expiredN,totN,'#ef4444')+
    rBar('Advertencia',warnN,totN,'#f97316')+
    rBar('Precaución',cautN,totN,'#f59e0b')+
    rBar('Vigentes',okN,totN,'#22c55e')+
    '</div></div></div></div>'+
    '<div class="risk-summary"><div class="risk-title">Estado de Flota</div>'+
    '<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-top:12px">'+
    statBox(App.vehicles.length,'Vehículos Totales','')+
    statBox(App.drivers.length,'Choferes Totales','')+
    statBox(App.vehicles.length-blV,'Vehículos Operativos','#22c55e')+
    statBox(App.drivers.length-blD,'Choferes Habilitados','#22c55e')+
    '</div></div></div>'+

    '<div class="critical-alerts-section"><div class="section-title">'+
    'Alertas Críticas <a class="see-all-link" href="#" onclick="navigate(\'alerts\');return false">Ver todas</a></div>'+
    '<div class="alerts-list">'+alertCards+'</div></div>';

  setTimeout(function(){
    drawDonut('ch-donut',[
      {v:expiredN,c:'#ef4444'},{v:critN,c:'#f97316'},{v:warnN,c:'#f59e0b'},
      {v:cautN,c:'#38bdf8'},{v:okN,c:'#22c55e'}
    ]);
    var cats=['vehicle','driver','company','waste'];
    var catClrs=['#2563eb','#38bdf8','#f97316','#f59e0b'];
    drawBars('ch-bars', cats.map(function(c,i){
      var n=App.expirations.filter(function(e){return e.category===c&&getStatus(e.expiryDate)!=='ok';}).length;
      return {l:CATS[c]||c,v:n,c:catClrs[i]};
    }));
  },0);
}

function kpi(lbl,val,sub,cls) {
  return '<div class="kpi-card '+cls+'"><div class="kpi-label">'+lbl+'</div>'+
    '<div class="kpi-value">'+val+'</div><div class="kpi-sub">'+sub+'</div></div>';
}
function ldot(color,lbl,n) {
  return '<div class="legend-item"><span class="legend-dot" style="background:'+color+'"></span>'+esc(lbl)+
    '<span style="margin-left:8px;font-weight:700;color:#0f172a">'+n+'</span></div>';
}
function rBar(lbl,n,tot,c) {
  var pct=tot>0?Math.min(100,Math.round(n/tot*100)):0;
  return '<div class="risk-bar-item"><span class="risk-bar-label" style="color:'+c+'">'+lbl+'</span>'+
    '<div class="risk-bar-track"><div class="risk-bar-fill" style="width:'+pct+'%;background:'+c+'"></div></div>'+
    '<span class="risk-bar-count" style="color:'+c+'">'+n+'</span></div>';
}
function statBox(n,lbl,c) {
  return '<div style="text-align:center;padding:10px;background:#f8fafc;border-radius:8px">'+
    '<div style="font-size:26px;font-weight:800;color:'+(c||'#0f172a')+'">'+n+'</div>'+
    '<div style="font-size:11px;color:#94a3b8">'+lbl+'</div></div>';
}
function warnIcon() {
  return '<svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M8 2L14 13H2L8 2Z" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/><path d="M8 6v3" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/><circle cx="8" cy="11.5" r="0.75" fill="currentColor"/></svg>';
}

// ─── ALERTS ──────────────────────────────────────────────────
function renderAlerts() {
  var el=document.getElementById('view-alerts');
  if(!el) return;
  var all=getAllAlerts();
  var tab=App.alertTab||'all';
  var filtered=tab==='all'?all:
    tab==='critical'?all.filter(function(a){return a.status==='expired'||a.status==='critical';}):
    all.filter(function(a){return a.status===tab;});

  var tabs=[
    {k:'all',l:'Todas',n:all.length},
    {k:'critical',l:'Críticas / Vencidas',n:all.filter(function(a){return a.status==='expired'||a.status==='critical';}).length},
    {k:'warning',l:'Advertencia (30d)',n:all.filter(function(a){return a.status==='warning';}).length},
    {k:'caution',l:'Precaución (60d)',n:all.filter(function(a){return a.status==='caution';}).length}
  ];

  var items=filtered.length?filtered.map(function(a){
    var d=a.days, dt=d<0?'Venció hace '+Math.abs(d)+' días':d===0?'Vence HOY':'Vence en '+d+' días';
    return '<div class="alert-card '+a.status+'"><div class="alert-icon '+a.status+'">'+warnIcon()+'</div>'+
      '<div class="alert-info"><div class="alert-entity">'+esc(a.entity)+
      ' <span style="font-size:10px;color:#94a3b8">· '+esc(CATS[a.cat]||'Empresa')+'</span></div>'+
      '<div class="alert-doc">'+esc(a.type)+'</div></div>'+
      '<div style="text-align:right"><div style="font-size:11px;color:#94a3b8">Vto. '+fmtDate(a.date)+'</div>'+
      '<div class="alert-days '+a.status+'">'+dt+'</div></div></div>';
  }).join(''):'<div class="empty-state"><div class="empty-state-title">Sin alertas en esta categoría</div></div>';

  el.innerHTML=
    '<div class="page-header"><div><div class="page-title">Centro de Alertas</div>'+
    '<div class="page-subtitle">'+all.length+' alertas activas en el sistema</div></div></div>'+
    '<div class="filter-tabs">'+tabs.map(function(t){
      return '<button class="filter-tab '+(tab===t.k?'active':'')+'" onclick="setAlertTab(\''+t.k+'\')">'+
        t.l+' <span style="background:rgba(0,0,0,.08);padding:0 5px;border-radius:8px;font-size:10px">'+t.n+'</span></button>';
    }).join('')+'</div>'+
    '<div class="alerts-list">'+items+'</div>';
}

function setAlertTab(t) { App.alertTab=t; renderAlerts(); }

// ─── VEHICLES ────────────────────────────────────────────────
function renderVehicles() {
  var el=document.getElementById('view-vehicles');
  if(!el) return;
  var q=(App.vehicleSearch||'').toLowerCase();
  var active=App.vehicles.filter(function(v){return v.active!==false;});
  var inactive=App.vehicles.filter(function(v){return v.active===false;});
  var filtered=q?active.filter(function(v){
    return (v.patent||'').toLowerCase().includes(q)||(v.brand||'').toLowerCase().includes(q)||(v.model||'').toLowerCase().includes(q);
  }):active;
  var blk=active.filter(function(v){return vehicleStatusStr(v.id)==='blocked';}).length;
  var alt=active.filter(function(v){return vehicleStatusStr(v.id)==='alert';}).length;

  var rows=filtered.map(function(v){
    var s=vehicleStatusStr(v.id);
    var sc=s==='blocked'?'badge-expired':s==='alert'?'badge-warning':'badge-ok';
    var sl=s==='blocked'?'BLOQUEADO':s==='alert'?'ALERTA':'OPERATIVO';
    var dn=v.driverId?getDriverName(v.driverId):'—';
    var vexps=App.expirations.filter(function(e){return e.vehicleId===v.id;});
    var expN=vexps.filter(function(e){return getStatus(e.expiryDate)==='expired';}).length;
    var warnN=vexps.filter(function(e){var st=getStatus(e.expiryDate);return st==='critical'||st==='warning';}).length;
    var docInfo=expN>0?'<span class="badge badge-expired">'+expN+' vencidos</span> ':warnN>0?'<span class="badge badge-warning">'+warnN+' alertas</span>':'<span class="badge badge-ok">OK</span>';
    return '<tr><td><span style="font-weight:700;color:#1d4ed8;font-family:monospace">'+esc(v.patent)+'</span></td>'+
      '<td>'+esc(v.brand)+' <span style="color:#94a3b8">'+esc(v.model)+'</span></td>'+
      '<td>'+v.year+'</td><td>'+esc(dn)+'</td><td>'+docInfo+'</td>'+
      '<td><span class="badge '+sc+'">'+sl+'</span></td>'+
      '<td><div class="action-btns">'+
      '<button class="btn-icon" onclick="editVehicle(\''+v.id+'\')" title="Editar">'+editIcon()+'</button>'+
      (isAdmin()?'<button class="btn-icon danger" onclick="delVehicle(\''+v.id+'\')" title="Dar de baja">'+delIcon()+'</button>':'')+
      '</div></td></tr>';
  }).join('');

  var inactiveRows=inactive.length&&isAdmin()?
    '<tr><td colspan="7" style="padding:8px 12px;background:#f8fafc;font-size:11px;color:#94a3b8;font-weight:600;text-transform:uppercase;letter-spacing:.5px">Dados de baja ('+inactive.length+')</td></tr>'+
    inactive.map(function(v){
      return '<tr style="opacity:.55"><td><span style="font-weight:700;font-family:monospace">'+esc(v.patent)+'</span></td>'+
        '<td>'+esc(v.brand)+' <span style="color:#94a3b8">'+esc(v.model)+'</span></td>'+
        '<td>'+v.year+'</td><td>—</td><td>—</td>'+
        '<td><span class="badge badge-expired">INACTIVO</span></td>'+
        '<td><div class="action-btns"><button class="btn-icon" style="color:#22c55e" onclick="restoreVehicle(\''+v.id+'\')" title="Restaurar">'+renewIcon()+'</button></div></td></tr>';
    }).join('')
  :'';

  el.innerHTML=
    '<div class="page-header"><div><div class="page-title">Gestión de Vehículos</div>'+
    '<div class="page-subtitle">Control de flota y documentación vehicular</div></div>'+
    '<div class="page-actions"><button class="btn-primary" onclick="addVehicle()">'+plusIcon()+' Nuevo Vehículo</button></div></div>'+
    '<div class="stats-bar">'+
    '<div class="stat-pill blue"><span class="stat-num">'+active.length+'</span><span class="stat-label">Total activos</span></div>'+
    '<div class="stat-pill green"><span class="stat-num">'+(active.length-blk-alt)+'</span><span class="stat-label">Operativos</span></div>'+
    '<div class="stat-pill orange"><span class="stat-num">'+alt+'</span><span class="stat-label">Con alertas</span></div>'+
    '<div class="stat-pill red"><span class="stat-num">'+blk+'</span><span class="stat-label">Bloqueados</span></div>'+
    '</div>'+
    '<div class="filter-row"><input type="text" class="filter-input" placeholder="Buscar patente, marca o modelo..." value="'+esc(App.vehicleSearch||'')+'" oninput="filterVehicles(this.value)"></div>'+
    '<div class="table-wrapper"><table>'+
    '<thead><tr><th>Patente</th><th>Marca / Modelo</th><th>Año</th><th>Chofer</th><th>Documentos</th><th>Estado</th><th>Acciones</th></tr></thead>'+
    '<tbody>'+(rows+inactiveRows||'<tr><td colspan="7" style="text-align:center;padding:40px;color:#94a3b8">Sin vehículos registrados</td></tr>')+'</tbody></table></div>';
}

function filterVehicles(v) { App.vehicleSearch=v; renderVehicles(); }

function vehicleFormHtml(v) {
  v=v||{};
  var dOpts='<option value="">— Sin asignar —</option>'+App.drivers.filter(function(d){return d.active!==false;}).map(function(d){
    return '<option value="'+d.id+'"'+(v.driverId===d.id?' selected':'')+'>'+esc(d.name+' '+d.lastName)+'</option>';
  }).join('');
  return '<div class="form-grid">'+
    fg('Patente *','<input class="form-control" id="fp-patent" value="'+esc(v.patent||'')+'" placeholder="AB 123 CD" style="text-transform:uppercase">')+
    fg('Marca *','<input class="form-control" id="fp-brand" value="'+esc(v.brand||'')+'" placeholder="Mercedes-Benz">')+
    fg('Modelo *','<input class="form-control" id="fp-model" value="'+esc(v.model||'')+'" placeholder="Actros 2651">')+
    fg('Año','<input class="form-control" id="fp-year" type="number" value="'+(v.year||new Date().getFullYear())+'" min="1990" max="2030">')+
    '<div class="form-group full">'+fl('Chofer Asignado')+'<select class="form-control" id="fp-driver">'+dOpts+'</select></div>'+
    '<div class="form-group full">'+fl('Observaciones')+'<textarea class="form-control" id="fp-notes" rows="2">'+esc(v.notes||'')+'</textarea></div>'+
    '</div>';
}

function addVehicle() {
  App.editId=null;
  openModal('Nuevo Vehículo', vehicleFormHtml(null), function(){
    var patent=(document.getElementById('fp-patent').value||'').trim().toUpperCase();
    var brand=(document.getElementById('fp-brand').value||'').trim();
    var model=(document.getElementById('fp-model').value||'').trim();
    if(!patent||!brand||!model){toast('Complete patente, marca y modelo','error');return false;}
    var body={patent:patent,brand:brand,model:model,
      year:parseInt(document.getElementById('fp-year').value)||new Date().getFullYear()};
    var driverId=document.getElementById('fp-driver').value;
    if(driverId) body.driverId=driverId;
    var notes=document.getElementById('fp-notes').value;
    if(notes) body.notes=notes;
    return apiJson('/vehicles',{method:'POST',body:JSON.stringify(body)})
    .then(function(v){
      App.vehicles.push(v);
      toast('Vehículo '+v.patent+' agregado');
      closeModal(); renderVehicles(); updateBadges();
    }).catch(function(err){toast(err.message||'Error al guardar','error');});
  });
}

function editVehicle(id) {
  var v=App.vehicles.find(function(x){return x.id===id;});
  if(!v) return;
  App.editId=id;
  openModal('Editar Vehículo', vehicleFormHtml(v), function(){
    var patent=(document.getElementById('fp-patent').value||'').trim().toUpperCase();
    var brand=(document.getElementById('fp-brand').value||'').trim();
    var model=(document.getElementById('fp-model').value||'').trim();
    if(!patent||!brand||!model){toast('Complete los campos obligatorios','error');return false;}
    var body={patent:patent,brand:brand,model:model,
      year:parseInt(document.getElementById('fp-year').value)||v.year,
      driverId:document.getElementById('fp-driver').value||null,
      notes:document.getElementById('fp-notes').value||null};
    return apiJson('/vehicles/'+id,{method:'PATCH',body:JSON.stringify(body)})
    .then(function(updated){
      var idx=App.vehicles.findIndex(function(x){return x.id===id;});
      if(idx!==-1) App.vehicles[idx]=updated;
      toast('Vehículo actualizado');
      closeModal(); renderVehicles(); updateBadges();
    }).catch(function(err){toast(err.message||'Error al actualizar','error');});
  });
}

function delVehicle(id) {
  var v=App.vehicles.find(function(x){return x.id===id;});
  if(!v||!confirm('¿Dar de baja el vehículo '+v.patent+'?')) return;
  apiJson('/vehicles/'+id,{method:'DELETE'})
  .then(function(){
    var idx=App.vehicles.findIndex(function(x){return x.id===id;});
    if(idx!==-1) App.vehicles[idx].active=false;
    App.expirations=App.expirations.filter(function(e){return e.vehicleId!==id;});
    toast('Vehículo dado de baja','warning'); renderVehicles(); updateBadges();
  }).catch(function(err){toast(err.message||'Error al dar de baja','error');});
}

function restoreVehicle(id) {
  apiJson('/vehicles/'+id+'/restore',{method:'PATCH'})
  .then(function(v){
    var idx=App.vehicles.findIndex(function(x){return x.id===id;});
    if(idx!==-1) App.vehicles[idx]=v; else App.vehicles.push(v);
    toast('Vehículo restaurado'); renderVehicles(); updateBadges();
  }).catch(function(err){toast(err.message||'Error al restaurar','error');});
}

// ─── DRIVERS ─────────────────────────────────────────────────
function renderDrivers() {
  var el=document.getElementById('view-drivers');
  if(!el) return;
  var q=(App.driverSearch||'').toLowerCase();
  var active=App.drivers.filter(function(d){return d.active!==false;});
  var inactive=App.drivers.filter(function(d){return d.active===false;});
  var filtered=q?active.filter(function(d){
    return (d.name+' '+d.lastName).toLowerCase().includes(q)||(d.dni||'').includes(q);
  }):active;
  var blk=active.filter(function(d){return driverStatusStr(d.id)==='blocked';}).length;
  var alt=active.filter(function(d){return driverStatusStr(d.id)==='alert';}).length;

  function docCell(did,type) {
    var e=App.expirations.find(function(x){return x.driverId===did&&x.type===type;});
    if(!e) return '<span style="color:#94a3b8">—</span>';
    var s=getStatus(e.expiryDate);
    return '<span style="font-size:12px;color:'+statusColor(s)+'">'+fmtDate(e.expiryDate)+'</span>';
  }

  var rows=filtered.map(function(d){
    var s=driverStatusStr(d.id);
    var sc=s==='blocked'?'badge-expired':s==='alert'?'badge-warning':'badge-ok';
    var sl=s==='blocked'?'NO HABILITADO':s==='alert'?'ALERTA':'HABILITADO';
    return '<tr><td><div style="font-weight:600">'+esc(d.name+' '+d.lastName)+'</div></td>'+
      '<td style="color:#94a3b8">'+esc(d.dni||'')+'</td>'+
      '<td><span class="badge badge-info">Cat. '+esc(d.licenseCategory||'')+'</span></td>'+
      '<td>'+docCell(d.id,'Licencia de Conducir')+'</td>'+
      '<td>'+docCell(d.id,'Psicofísico')+'</td>'+
      '<td>'+docCell(d.id,'ART')+'</td>'+
      '<td><span class="badge '+sc+'">'+sl+'</span></td>'+
      '<td><div class="action-btns">'+
      '<button class="btn-icon" onclick="editDriver(\''+d.id+'\')" title="Editar">'+editIcon()+'</button>'+
      (isAdmin()?'<button class="btn-icon danger" onclick="delDriver(\''+d.id+'\')" title="Dar de baja">'+delIcon()+'</button>':'')+
      '</div></td></tr>';
  }).join('');

  var inactiveRows=inactive.length&&isAdmin()?
    '<tr><td colspan="8" style="padding:8px 12px;background:#f8fafc;font-size:11px;color:#94a3b8;font-weight:600;text-transform:uppercase;letter-spacing:.5px">Dados de baja ('+inactive.length+')</td></tr>'+
    inactive.map(function(d){
      return '<tr style="opacity:.55"><td><div style="font-weight:600">'+esc(d.name+' '+d.lastName)+'</div></td>'+
        '<td style="color:#94a3b8">'+esc(d.dni||'')+'</td>'+
        '<td>—</td><td>—</td><td>—</td><td>—</td>'+
        '<td><span class="badge badge-expired">INACTIVO</span></td>'+
        '<td><div class="action-btns"><button class="btn-icon" style="color:#22c55e" onclick="restoreDriver(\''+d.id+'\')" title="Restaurar">'+renewIcon()+'</button></div></td></tr>';
    }).join('')
  :'';

  el.innerHTML=
    '<div class="page-header"><div><div class="page-title">Gestión de Choferes</div>'+
    '<div class="page-subtitle">Control de habilitaciones y documentación de conductores</div></div>'+
    '<div class="page-actions"><button class="btn-primary" onclick="addDriver()">'+plusIcon()+' Nuevo Chofer</button></div></div>'+
    '<div class="stats-bar">'+
    '<div class="stat-pill blue"><span class="stat-num">'+active.length+'</span><span class="stat-label">Total activos</span></div>'+
    '<div class="stat-pill green"><span class="stat-num">'+(active.length-blk-alt)+'</span><span class="stat-label">Habilitados</span></div>'+
    '<div class="stat-pill orange"><span class="stat-num">'+alt+'</span><span class="stat-label">Con alertas</span></div>'+
    '<div class="stat-pill red"><span class="stat-num">'+blk+'</span><span class="stat-label">Bloqueados</span></div>'+
    '</div>'+
    '<div class="filter-row"><input type="text" class="filter-input" placeholder="Buscar por nombre o DNI..." value="'+esc(App.driverSearch||'')+'" oninput="filterDrivers(this.value)"></div>'+
    '<div class="table-wrapper"><table>'+
    '<thead><tr><th>Nombre</th><th>DNI</th><th>Cat.</th><th>Vto. Licencia</th><th>Vto. Psicofísico</th><th>Vto. ART</th><th>Estado</th><th>Acciones</th></tr></thead>'+
    '<tbody>'+(rows+inactiveRows||'<tr><td colspan="8" style="text-align:center;padding:40px;color:#94a3b8">Sin choferes registrados</td></tr>')+'</tbody></table></div>';
}

function filterDrivers(v) { App.driverSearch=v; renderDrivers(); }

function driverFormHtml(d) {
  d=d||{};
  var cats=['B','C','D','E','F'];
  return '<div class="form-grid">'+
    fg('Nombre *','<input class="form-control" id="fd-name" value="'+esc(d.name||'')+'">')+
    fg('Apellido *','<input class="form-control" id="fd-lastName" value="'+esc(d.lastName||'')+'">')+
    fg('DNI','<input class="form-control" id="fd-dni" value="'+esc(d.dni||'')+'" placeholder="28456789">')+
    fg('Nro. Licencia','<input class="form-control" id="fd-license" value="'+esc(d.licenseNumber||'')+'">')+
    fg('Categoría','<select class="form-control" id="fd-cat">'+cats.map(function(c){return '<option value="'+c+'"'+(d.licenseCategory===c?' selected':'')+'>'+c+'</option>';}).join('')+'</select>')+
    fg('Observaciones','<textarea class="form-control" id="fd-notes" rows="2">'+esc(d.notes||'')+'</textarea>')+
    '</div>';
}

function addDriver() {
  App.editId=null;
  openModal('Nuevo Chofer', driverFormHtml(null), function(){
    var name=(document.getElementById('fd-name').value||'').trim();
    var lastName=(document.getElementById('fd-lastName').value||'').trim();
    if(!name||!lastName){toast('Complete nombre y apellido','error');return false;}
    var body={name:name,lastName:lastName,
      dni:document.getElementById('fd-dni').value.trim(),
      licenseNumber:document.getElementById('fd-license').value.trim(),
      licenseCategory:document.getElementById('fd-cat').value,
      notes:document.getElementById('fd-notes').value||undefined};
    return apiJson('/drivers',{method:'POST',body:JSON.stringify(body)})
    .then(function(d){
      App.drivers.push(d);
      toast('Chofer '+d.name+' '+d.lastName+' agregado');
      closeModal(); renderDrivers(); updateBadges();
    }).catch(function(err){toast(err.message||'Error al guardar','error');});
  });
}

function editDriver(id) {
  var d=App.drivers.find(function(x){return x.id===id;});
  if(!d) return;
  App.editId=id;
  openModal('Editar Chofer', driverFormHtml(d), function(){
    var name=(document.getElementById('fd-name').value||'').trim();
    var lastName=(document.getElementById('fd-lastName').value||'').trim();
    if(!name||!lastName){toast('Complete nombre y apellido','error');return false;}
    var body={name:name,lastName:lastName,
      dni:document.getElementById('fd-dni').value.trim(),
      licenseNumber:document.getElementById('fd-license').value.trim(),
      licenseCategory:document.getElementById('fd-cat').value,
      notes:document.getElementById('fd-notes').value||null};
    return apiJson('/drivers/'+id,{method:'PATCH',body:JSON.stringify(body)})
    .then(function(updated){
      var idx=App.drivers.findIndex(function(x){return x.id===id;});
      if(idx!==-1) App.drivers[idx]=updated;
      toast('Chofer actualizado');
      closeModal(); renderDrivers(); updateBadges();
    }).catch(function(err){toast(err.message||'Error al actualizar','error');});
  });
}

function delDriver(id) {
  var d=App.drivers.find(function(x){return x.id===id;});
  if(!d||!confirm('¿Dar de baja al chofer '+d.name+' '+d.lastName+'?')) return;
  apiJson('/drivers/'+id,{method:'DELETE'})
  .then(function(){
    var idx=App.drivers.findIndex(function(x){return x.id===id;});
    if(idx!==-1) App.drivers[idx].active=false;
    toast('Chofer dado de baja','warning'); renderDrivers(); updateBadges();
  }).catch(function(err){toast(err.message||'Error al dar de baja','error');});
}

function restoreDriver(id) {
  apiJson('/drivers/'+id+'/restore',{method:'PATCH'})
  .then(function(d){
    var idx=App.drivers.findIndex(function(x){return x.id===id;});
    if(idx!==-1) App.drivers[idx]=d; else App.drivers.push(d);
    toast('Chofer restaurado'); renderDrivers(); updateBadges();
  }).catch(function(err){toast(err.message||'Error al restaurar','error');});
}

// ─── EXPIRATIONS ─────────────────────────────────────────────
function renderExpirations() {
  var el=document.getElementById('view-expirations');
  if(!el) return;
  var filtered=App.expirations.slice();
  if(App.expCatFilter&&App.expCatFilter!=='all')
    filtered=filtered.filter(function(e){return e.category===App.expCatFilter;});
  if(App.expStatusFilter&&App.expStatusFilter!=='all')
    filtered=filtered.filter(function(e){return getStatus(e.expiryDate)===App.expStatusFilter;});
  filtered.sort(function(a,b){return getDays(a.expiryDate)-getDays(b.expiryDate);});

  var rows=filtered.map(function(e){
    var s=getStatus(e.expiryDate), d=getDays(e.expiryDate);
    var entity=e.vehicleId?getVehicleName(e.vehicleId):e.driverId?getDriverName(e.driverId):'Empresa';
    var dText=d<0?'-'+Math.abs(d)+'d':d===0?'HOY':d+'d';
    return '<tr><td style="max-width:180px"><div style="font-weight:500">'+esc(e.type)+'</div></td>'+
      '<td><span class="badge badge-info">'+esc(CATS[e.category]||e.category)+'</span></td>'+
      '<td style="color:#94a3b8;font-size:12px">'+esc(entity)+'</td>'+
      '<td style="color:#94a3b8;font-size:12px">'+fmtDate(e.issueDate)+'</td>'+
      '<td style="font-weight:500">'+fmtDate(e.expiryDate)+'</td>'+
      '<td><span style="font-weight:700;color:'+statusColor(s)+'">'+dText+'</span></td>'+
      '<td><span class="badge badge-'+s+'">'+statusLabel(s)+'</span></td>'+
      '<td><div class="action-btns">'+
      '<button class="btn-icon" style="color:#22c55e" onclick="renewExp(\''+e.id+'\')" title="Renovar">'+renewIcon()+'</button>'+
      '<button class="btn-icon" onclick="editExp(\''+e.id+'\')" title="Editar">'+editIcon()+'</button>'+
      '<button class="btn-icon danger" onclick="delExp(\''+e.id+'\')" title="Eliminar">'+delIcon()+'</button>'+
      '</div></td></tr>';
  }).join('');

  el.innerHTML=
    '<div class="page-header"><div><div class="page-title">Gestión de Vencimientos</div>'+
    '<div class="page-subtitle">'+App.expirations.length+' documentos registrados</div></div>'+
    '<div class="page-actions">'+
    '<button class="btn-ghost" onclick="downloadTemplate()" title="Descargar plantilla CSV de ejemplo">'+dlIcon()+' Plantilla CSV</button>'+
    '<button class="btn-ghost" onclick="triggerImportCSV()">'+upIcon()+' Importar CSV</button>'+
    '<input type="file" id="csv-import-input" accept=".csv" style="display:none" onchange="importCSVFile(this)">'+
    '<button class="btn-primary" onclick="addExp()">'+plusIcon()+' Nuevo Vencimiento</button></div></div>'+
    '<div class="filter-row">'+
    '<select class="filter-select" onchange="setExpFilter(\'cat\',this.value)">'+
    '<option value="all">Todas las categorías</option>'+
    Object.entries(CATS).map(function(e){return '<option value="'+e[0]+'"'+(App.expCatFilter===e[0]?' selected':'')+'>'+e[1]+'</option>';}).join('')+
    '</select>'+
    '<select class="filter-select" onchange="setExpFilter(\'status\',this.value)">'+
    '<option value="all">Todos los estados</option>'+
    '<option value="expired"'+(App.expStatusFilter==='expired'?' selected':'')+'>Vencidos</option>'+
    '<option value="critical"'+(App.expStatusFilter==='critical'?' selected':'')+'>Críticos (15d)</option>'+
    '<option value="warning"'+(App.expStatusFilter==='warning'?' selected':'')+'>Advertencia (30d)</option>'+
    '<option value="caution"'+(App.expStatusFilter==='caution'?' selected':'')+'>Precaución (60d)</option>'+
    '<option value="ok"'+(App.expStatusFilter==='ok'?' selected':'')+'>Vigentes</option>'+
    '</select>'+
    '<span style="font-size:12px;color:#94a3b8">'+filtered.length+' resultado'+( filtered.length!==1?'s':'')+'</span></div>'+
    '<div class="table-wrapper"><table>'+
    '<thead><tr><th>Tipo</th><th>Cat.</th><th>Entidad</th><th>Emisión</th><th>Vencimiento</th><th>Días</th><th>Estado</th><th>Acciones</th></tr></thead>'+
    '<tbody>'+(rows||'<tr><td colspan="8" style="text-align:center;padding:40px;color:#94a3b8">Sin registros</td></tr>')+'</tbody></table></div>';
}

function setExpFilter(f,v) {
  if(f==='cat') App.expCatFilter=v;
  else App.expStatusFilter=v;
  renderExpirations();
}

function expFormHtml(e) {
  e=e||{};
  var allTypes=['Seguro RC','VTV / RTO','Matafuegos','Habilitación Municipal','Verificación Técnica',
    'Tacógrafo','Licencia de Conducir','Psicofísico','ART','Curso Cargas Peligrosas',
    'Examen Médico','Habilitación Empresa','Póliza General','Habilitación SENASA','Otra'];
  var vOpts='<option value="">— Sin vehículo —</option>'+App.vehicles.filter(function(v){return v.active!==false;}).map(function(v){
    return '<option value="'+v.id+'"'+(e.vehicleId===v.id?' selected':'')+'>'+esc(v.patent)+' — '+esc(v.brand+' '+v.model)+'</option>';
  }).join('');
  var dOpts='<option value="">— Sin chofer —</option>'+App.drivers.filter(function(d){return d.active!==false;}).map(function(d){
    return '<option value="'+d.id+'"'+(e.driverId===d.id?' selected':'')+'>'+esc(d.name+' '+d.lastName)+'</option>';
  }).join('');
  var catOpts=Object.entries(CATS).map(function(c){return '<option value="'+c[0]+'"'+(e.category===c[0]?' selected':'')+'>'+c[1]+'</option>';}).join('');
  return '<div class="form-grid">'+
    '<div class="form-group full">'+fl('Tipo de Documento *')+
    '<input class="form-control" id="fe-type" list="fe-types" value="'+esc(e.type||'')+'" placeholder="Ej: Seguro RC, VTV, Psicofísico...">'+
    '<datalist id="fe-types">'+allTypes.map(function(t){return '<option value="'+esc(t)+'">';}).join('')+'</datalist></div>'+
    fg('Categoría','<select class="form-control" id="fe-cat">'+catOpts+'</select>')+
    fg('Vehículo','<select class="form-control" id="fe-vid">'+vOpts+'</select>')+
    fg('Chofer','<select class="form-control" id="fe-did">'+dOpts+'</select>')+
    fg('Fecha Emisión','<input class="form-control" id="fe-issue" type="date" value="'+(e.issueDate||toISO(today0()))+'">')+
    fg('Fecha Vencimiento *','<input class="form-control" id="fe-expiry" type="date" value="'+(e.expiryDate||'')+'">')+
    '<div class="form-group full">'+fl('Descripción / Observaciones')+
    '<textarea class="form-control" id="fe-obs" rows="2">'+esc(e.observations||'')+'</textarea></div>'+
    '</div>';
}

function addExp() {
  App.editId=null;
  openModal('Nuevo Vencimiento', expFormHtml(null), function(){
    var type=(document.getElementById('fe-type').value||'').trim();
    var expiry=document.getElementById('fe-expiry').value;
    if(!type||!expiry){toast('Complete tipo y fecha de vencimiento','error');return false;}
    var cat=document.getElementById('fe-cat').value;
    var vehicleId=document.getElementById('fe-vid').value||null;
    var driverId=document.getElementById('fe-did').value||null;
    if(cat==='vehicle'&&!vehicleId){toast('La categoría VEHÍCULO requiere un vehículo','error');return false;}
    if(cat==='driver'&&!driverId){toast('La categoría CHOFER requiere un chofer','error');return false;}
    if(cat==='company'&&(vehicleId||driverId)){toast('La categoría EMPRESA no puede tener vehículo ni chofer','error');return false;}
    var body={type:type,category:catToApi(cat),expiryDate:expiry};
    var issue=document.getElementById('fe-issue').value; if(issue) body.issueDate=issue;
    if(vehicleId) body.vehicleId=vehicleId;
    if(driverId) body.driverId=driverId;
    var obs=document.getElementById('fe-obs').value; if(obs) body.observations=obs;
    return apiJson('/expirations',{method:'POST',body:JSON.stringify(body)})
    .then(function(e){
      App.expirations.push(normalizeExpiration(e));
      toast('Vencimiento registrado');
      closeModal(); renderExpirations(); updateBadges();
    }).catch(function(err){toast(err.message||'Error al guardar','error');});
  });
}

function editExp(id) {
  var e=App.expirations.find(function(x){return x.id===id;});
  if(!e) return;
  App.editId=id;
  openModal('Editar Vencimiento', expFormHtml(e), function(){
    var type=(document.getElementById('fe-type').value||'').trim();
    var expiry=document.getElementById('fe-expiry').value;
    if(!type||!expiry){toast('Complete tipo y fecha de vencimiento','error');return false;}
    var cat=document.getElementById('fe-cat').value;
    var vehicleId=document.getElementById('fe-vid').value||null;
    var driverId=document.getElementById('fe-did').value||null;
    if(cat==='vehicle'&&!vehicleId){toast('La categoría VEHÍCULO requiere un vehículo','error');return false;}
    if(cat==='driver'&&!driverId){toast('La categoría CHOFER requiere un chofer','error');return false;}
    if(cat==='company'&&(vehicleId||driverId)){toast('La categoría EMPRESA no puede tener vehículo ni chofer','error');return false;}
    var body={type:type,category:catToApi(cat),vehicleId:vehicleId,driverId:driverId,expiryDate:expiry};
    var issue=document.getElementById('fe-issue').value; if(issue) body.issueDate=issue;
    body.observations=document.getElementById('fe-obs').value||null;
    return apiJson('/expirations/'+id,{method:'PATCH',body:JSON.stringify(body)})
    .then(function(updated){
      var idx=App.expirations.findIndex(function(x){return x.id===id;});
      if(idx!==-1) App.expirations[idx]=normalizeExpiration(updated);
      toast('Vencimiento actualizado');
      closeModal(); renderExpirations(); updateBadges();
    }).catch(function(err){toast(err.message||'Error al actualizar','error');});
  });
}

function renewExp(id) {
  var e=App.expirations.find(function(x){return x.id===id;});
  if(!e) return;
  var html='<div class="form-grid cols-1">'+
    '<p style="color:#475569;margin-bottom:8px">Renovando: <strong>'+esc(e.type)+'</strong></p>'+
    fg('Nueva Fecha de Emisión','<input class="form-control" id="fr-issue" type="date" value="'+toISO(today0())+'">')+
    fg('Nueva Fecha de Vencimiento *','<input class="form-control" id="fr-expiry" type="date" value="'+relDate(365)+'">')+
    fg('Observaciones','<textarea class="form-control" id="fr-obs" rows="2">'+esc(e.observations||'')+'</textarea>')+
    '</div>';
  openModal('Renovar Documento', html, function(){
    var newExpiry=document.getElementById('fr-expiry').value;
    if(!newExpiry){toast('Ingrese nueva fecha de vencimiento','error');return false;}
    var body={
      issueDate:document.getElementById('fr-issue').value||null,
      expiryDate:newExpiry,
      observations:document.getElementById('fr-obs').value||null
    };
    return apiJson('/expirations/'+id,{method:'PATCH',body:JSON.stringify(body)})
    .then(function(updated){
      var idx=App.expirations.findIndex(function(x){return x.id===id;});
      if(idx!==-1) App.expirations[idx]=normalizeExpiration(updated);
      toast('Documento renovado');
      closeModal(); renderExpirations(); updateBadges();
    }).catch(function(err){toast(err.message||'Error al renovar','error');});
  });
}

function delExp(id) {
  var e=App.expirations.find(function(x){return x.id===id;});
  if(!e||!confirm('¿Eliminar "'+e.type+'"?')) return;
  apiJson('/expirations/'+id,{method:'DELETE'})
  .then(function(){
    App.expirations=App.expirations.filter(function(x){return x.id!==id;});
    toast('Vencimiento eliminado','warning'); renderExpirations(); updateBadges();
  }).catch(function(err){toast(err.message||'Error al eliminar','error');});
}

// ─── CSV IMPORT ──────────────────────────────────────────────

function downloadTemplate() {
  var hdr = 'tipo,categoria,descripcion,vehiculo,chofer,fecha_emision,fecha_vencimiento,observaciones\r\n';
  var ex1 = '"Seguro RC","vehiculo","Seguro de Responsabilidad Civil","AB 123 CD","","01/01/2025","31/12/2025",""\r\n';
  var ex2 = '"Licencia de Conducir","chofer","Licencia categoría D","","Juan Pérez","15/01/2025","15/01/2027","Renovación habitual"\r\n';
  var ex3 = '"Habilitación Empresa","empresa","Habilitación Municipal","","","01/03/2025","01/03/2026",""\r\n';
  var note = '"","","","","","","",""\r\n';
  var noteRow = '"--- CATEGORÍAS VÁLIDAS: vehiculo | chofer | empresa | residuos ---","","","","","","",""\r\n';
  var csv = '﻿' + hdr + ex1 + ex2 + ex3 + note + noteRow;
  var blob = new Blob([csv], {type:'text/csv;charset=utf-8'});
  var url = URL.createObjectURL(blob);
  var a = document.createElement('a'); a.href=url; a.download='plantilla-vencimientos.csv';
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  URL.revokeObjectURL(url);
  toast('Plantilla descargada');
}

function triggerImportCSV() {
  var inp = document.getElementById('csv-import-input');
  if (!inp) { toast('Navegá a Vencimientos primero', 'error'); return; }
  inp.value = '';
  inp.click();
}

function parseCSVText(text) {
  text = text.replace(/^﻿/, '');
  var lines = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
  var results = [];
  function parseRow(line) {
    var row=[], cur='', inQ=false;
    for(var i=0; i<line.length; i++) {
      var c=line[i];
      if(inQ) {
        if(c==='"') { if(line[i+1]==='"'){cur+='"';i++;} else inQ=false; }
        else cur+=c;
      } else {
        if(c==='"') inQ=true;
        else if(c===','){row.push(cur);cur='';}
        else cur+=c;
      }
    }
    row.push(cur);
    return row;
  }
  for(var i=0; i<lines.length; i++) {
    if(lines[i].trim()) results.push(parseRow(lines[i]));
  }
  return results;
}

function parseDateCSV(s) {
  if(!s||!s.trim()) return null;
  s=s.trim();
  var m=s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if(m) {
    var d=new Date(Number(m[3]),Number(m[2])-1,Number(m[1]));
    if(isNaN(d.getTime())||d.getDate()!==Number(m[1])) return null;
    return toISO(d);
  }
  if(/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    var d2=new Date(s+'T00:00:00');
    return isNaN(d2.getTime())?null:s;
  }
  return null;
}

function normalizeCat(s) {
  s=(s||'').trim().toLowerCase();
  if(s==='vehículo'||s==='vehiculo'||s==='vehicle') return 'vehicle';
  if(s==='chofer'||s==='conductor'||s==='driver') return 'driver';
  if(s==='empresa'||s==='company') return 'company';
  if(s==='residuos'||s==='waste'||s==='peligrosos') return 'waste';
  return 'vehicle';
}

function findVehicleByStr(s) {
  if(!s||!s.trim()) return '';
  var q=s.trim().toLowerCase().replace(/\s+/g,'');
  var v=App.vehicles.find(function(x){
    return (x.patent||'').toLowerCase().replace(/\s+/g,'')=== q;
  });
  return v?v.id:null;
}

function findDriverByStr(s) {
  if(!s||!s.trim()) return '';
  var q=s.trim().toLowerCase();
  var d=App.drivers.find(function(x){
    return (x.name+' '+x.lastName).toLowerCase()===q ||
           (x.lastName+' '+x.name).toLowerCase()===q;
  });
  return d?d.id:null;
}

function importCSVFile(input) {
  var file=input.files[0];
  if(!file) return;
  var reader=new FileReader();
  reader.onload=function(ev){ processImport(ev.target.result); };
  reader.onerror=function(){ toast('Error al leer el archivo','error'); };
  reader.readAsText(file,'UTF-8');
}

function processImport(text) {
  var rows=parseCSVText(text);
  if(!rows.length){toast('Archivo vacío','error');return;}

  var header=rows[0].map(function(h){return h.trim().toLowerCase();});
  var missing=['tipo','fecha_vencimiento'].filter(function(c){return header.indexOf(c)===-1;});
  if(missing.length) {
    openModal('Error de importación',
      '<div style="padding:16px">'+
      '<p style="color:#ef4444;font-weight:700;margin-bottom:10px">Columnas obligatorias faltantes:</p>'+
      '<p style="font-family:monospace;background:#fee2e2;padding:8px;border-radius:6px;color:#b91c1c">'+esc(missing.join(', '))+'</p>'+
      '<p style="color:#64748b;font-size:13px;margin-top:12px">Usá el botón "Plantilla CSV" para descargar el formato correcto.</p>'+
      '</div>', null);
    return;
  }

  function col(row,name){var idx=header.indexOf(name);return idx>=0?(row[idx]||'').trim():'';}

  var toCreate=[], parseErrors=[];
  var dataRows=rows.slice(1).filter(function(r){return r.some(function(c){return c.trim();});});

  dataRows.forEach(function(row,i){
    var rowNum=i+2;
    var tipo=col(row,'tipo');
    var expStr=col(row,'fecha_vencimiento');
    if(!tipo){parseErrors.push('Fila '+rowNum+': campo "tipo" vacío');return;}
    if(!expStr){parseErrors.push('Fila '+rowNum+': campo "fecha_vencimiento" vacío');return;}
    var expiryDate=parseDateCSV(expStr);
    if(!expiryDate){parseErrors.push('Fila '+rowNum+': fecha_vencimiento inválida — "'+expStr+'"');return;}

    var issueStr=col(row,'fecha_emision');
    var issueDate=issueStr?parseDateCSV(issueStr):null;
    if(issueStr&&!issueDate) parseErrors.push('Fila '+rowNum+': fecha_emision inválida — se omite');

    var category=normalizeCat(col(row,'categoria'));
    var vehicleId=null, driverId=null;
    var vStr=col(row,'vehiculo'), dStr=col(row,'chofer');
    if(vStr){var vf=findVehicleByStr(vStr);if(!vf)parseErrors.push('Fila '+rowNum+': vehículo "'+vStr+'" no encontrado — sin vehículo');else vehicleId=vf;}
    if(dStr){var df=findDriverByStr(dStr);if(!df)parseErrors.push('Fila '+rowNum+': chofer "'+dStr+'" no encontrado — sin chofer');else driverId=df;}

    var dup=App.expirations.find(function(e){
      return e.type.toLowerCase()===tipo.toLowerCase()&&
             (e.vehicleId||null)===(vehicleId||null)&&
             (e.driverId||null)===(driverId||null)&&
             e.expiryDate===expiryDate;
    });
    if(dup){parseErrors.push('Fila '+rowNum+': duplicado — "'+tipo+'" ya existe');return;}

    var body={type:tipo,category:catToApi(category),expiryDate:expiryDate};
    if(vehicleId) body.vehicleId=vehicleId;
    if(driverId) body.driverId=driverId;
    if(issueDate) body.issueDate=issueDate;
    var desc=col(row,'descripcion'); if(desc) body.description=desc;
    var obs=col(row,'observaciones'); if(obs) body.observations=obs;
    toCreate.push(body);
  });

  if(!toCreate.length) {
    openModal('Sin registros para importar',
      '<div style="padding:16px"><p style="color:#475569">No se encontraron registros válidos para importar.</p>'+
      (parseErrors.length?'<div style="margin-top:12px;background:#fef9c3;border-radius:8px;padding:10px;max-height:140px;overflow-y:auto">'+
      '<ul style="margin:0;padding-left:18px;font-size:12px;color:#713f12">'+parseErrors.slice(0,15).map(function(e){return '<li>'+esc(e)+'</li>';}).join('')+'</ul></div>':'')+
      '</div>', null);
    return;
  }

  var omitted=dataRows.length-toCreate.length;
  var previewHtml='<div style="padding:4px">'+
    '<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:16px">'+
    '<div style="background:#dbeafe;border-radius:8px;padding:14px;text-align:center">'+
    '<div style="font-size:28px;font-weight:800;color:#1d4ed8">'+toCreate.length+'</div>'+
    '<div style="font-size:12px;color:#1e40af;font-weight:600">A crear</div></div>'+
    '<div style="background:#fee2e2;border-radius:8px;padding:14px;text-align:center">'+
    '<div style="font-size:28px;font-weight:800;color:#b91c1c">'+omitted+'</div>'+
    '<div style="font-size:12px;color:#991b1b;font-weight:600">Omitidos</div></div></div>'+
    (parseErrors.length?'<div style="background:#fef9c3;border:1px solid #fde68a;border-radius:8px;padding:10px;margin-bottom:12px;max-height:120px;overflow-y:auto">'+
    '<ul style="margin:0;padding-left:18px;font-size:11px;color:#713f12">'+parseErrors.slice(0,15).map(function(e){return '<li>'+esc(e)+'</li>';}).join('')+
    (parseErrors.length>15?'<li>...y '+(parseErrors.length-15)+' más</li>':'')+'</ul></div>':'')+
    '<p style="font-size:13px;color:#475569">Hacé clic en <strong>Guardar</strong> para importar los '+toCreate.length+' registros vía API.</p></div>';

  openModal('Importar Vencimientos', previewHtml, function(){
    var bodyEl=document.getElementById('modal-body');
    var imported=0, failed=0, apiErrors=[];

    function next(i) {
      if(i>=toCreate.length) {
        return apiJson('/expirations?limit=100').then(function(resp){
          App.expirations=(resp.data||[]).map(normalizeExpiration);
          renderExpirations(); updateBadges();
          var summaryHtml='<div style="padding:4px">'+
            '<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin-bottom:16px">'+
            '<div style="background:#dcfce7;border-radius:10px;padding:16px;text-align:center">'+
            '<div style="font-size:34px;font-weight:800;color:#15803d">'+imported+'</div>'+
            '<div style="font-size:12px;color:#166534;font-weight:600;margin-top:4px">Importados</div></div>'+
            '<div style="background:#fee2e2;border-radius:10px;padding:16px;text-align:center">'+
            '<div style="font-size:34px;font-weight:800;color:#b91c1c">'+failed+'</div>'+
            '<div style="font-size:12px;color:#991b1b;font-weight:600;margin-top:4px">Fallidos</div></div>'+
            '<div style="background:#f1f5f9;border-radius:10px;padding:16px;text-align:center">'+
            '<div style="font-size:34px;font-weight:800;color:#475569">'+toCreate.length+'</div>'+
            '<div style="font-size:12px;color:#64748b;font-weight:600;margin-top:4px">Procesados</div></div></div>'+
            (apiErrors.length?'<div style="background:#fef9c3;border:1px solid #fde68a;border-radius:8px;padding:10px;max-height:100px;overflow-y:auto">'+
            '<ul style="margin:0;padding-left:18px;font-size:11px;color:#713f12">'+apiErrors.slice(0,15).map(function(e){return '<li>'+esc(e)+'</li>';}).join('')+'</ul></div>':'')+
            '<p style="font-size:13px;font-weight:600;margin-top:12px;color:'+(imported>0?'#15803d':'#ef4444')+'">'+
            (imported>0?'✓ '+imported+' vencimientos importados correctamente.':'No se importó ningún registro.')+'</p></div>';
          if(bodyEl) bodyEl.innerHTML=summaryHtml;
          var saveBtn=document.getElementById('modal-save');
          if(saveBtn){saveBtn.textContent='Cerrar';saveBtn.disabled=false;App.modalCb=function(){closeModal();};}
          toast(imported>0?imported+' registros importados':'Sin registros importados',imported>0?'success':'warning');
        }).catch(function(){});
      }
      if(bodyEl){
        bodyEl.innerHTML='<div style="padding:30px;text-align:center">'+
          '<div style="font-size:14px;color:#475569">Importando '+(i+1)+' de '+toCreate.length+'...</div>'+
          '<div style="margin-top:10px;background:#e2e8f0;border-radius:4px;height:8px">'+
          '<div style="background:#2563eb;height:8px;border-radius:4px;width:'+Math.round(i/toCreate.length*100)+'%"></div></div></div>';
      }
      return apiJson('/expirations',{method:'POST',body:JSON.stringify(toCreate[i])})
      .then(function(){imported++;})
      .catch(function(err){failed++;apiErrors.push('Item '+(i+1)+': '+(err.message||'Error'));})
      .then(function(){return next(i+1);});
    }

    return next(0);
  });
}

// ─── HAZARDOUS ───────────────────────────────────────────────
function renderHazardous() {
  var el=document.getElementById('view-hazardous');
  if(!el) return;
  var rows=App.hazardous.map(function(h){
    var s=getStatus(h.expiryDate), d=getDays(h.expiryDate);
    var dText=d<0?Math.abs(d)+'d venc.':d===0?'HOY':d+'d';
    return '<tr><td style="font-weight:500">'+esc(h.type)+'</td>'+
      '<td>'+esc(h.entityName)+'</td>'+
      '<td style="font-family:monospace;font-size:12px">'+esc(h.permitNumber||'—')+'</td>'+
      '<td style="color:#94a3b8;font-size:12px">'+esc(h.issuingAuthority||'—')+'</td>'+
      '<td style="font-size:12px">'+fmtDate(h.issueDate)+'</td>'+
      '<td style="font-weight:500">'+fmtDate(h.expiryDate)+'</td>'+
      '<td><span style="font-weight:700;color:'+statusColor(s)+'">'+dText+'</span></td>'+
      '<td><span class="badge badge-'+s+'">'+statusLabel(s)+'</span></td>'+
      '<td><div class="action-btns">'+
      '<button class="btn-icon" onclick="editHaz(\''+h.id+'\')" title="Editar">'+editIcon()+'</button>'+
      (isAdmin()?'<button class="btn-icon danger" onclick="delHaz(\''+h.id+'\')" title="Eliminar">'+delIcon()+'</button>':'')+
      '</div></td></tr>';
  }).join('');

  el.innerHTML=
    '<div class="page-header"><div><div class="page-title">Residuos Peligrosos</div>'+
    '<div class="page-subtitle">Control normativo y habilitaciones ambientales</div></div>'+
    '<div class="page-actions"><button class="btn-primary" onclick="addHaz()">'+plusIcon()+' Agregar Registro</button></div></div>'+
    '<div class="hazardous-info">Control de habilitaciones ambientales, permisos de transporte de residuos peligrosos, polizas ambientales y certificaciones regulatorias.</div>'+
    '<div class="table-wrapper"><table>'+
    '<thead><tr><th>Tipo</th><th>Entidad</th><th>Nro. Permiso</th><th>Autoridad</th><th>Emisión</th><th>Vencimiento</th><th>Días</th><th>Estado</th><th>Acc.</th></tr></thead>'+
    '<tbody>'+(rows||'<tr><td colspan="9" style="text-align:center;padding:40px;color:#94a3b8">Sin registros</td></tr>')+'</tbody></table></div>';
}

function hazFormHtml(h) {
  h=h||{};
  var types=['Habilitación Ambiental','Permiso de Transporte','Póliza Ambiental','Contrato de Cliente','Certificado Regulatorio','Manifiesto Residuos','Otra Documentación'];
  return '<div class="form-grid">'+
    fg('Tipo *','<select class="form-control" id="fh-type">'+types.map(function(t){return '<option value="'+t+'"'+(h.type===t?' selected':'')+'>'+t+'</option>';}).join('')+'</select>')+
    fg('Entidad / Empresa','<input class="form-control" id="fh-entity" value="'+esc(h.entityName||'')+'">')+
    fg('Nro. Permiso','<input class="form-control" id="fh-permit" value="'+esc(h.permitNumber||'')+'" placeholder="HA-2024-001">')+
    fg('Autoridad Emisora','<input class="form-control" id="fh-auth" value="'+esc(h.issuingAuthority||'')+'">')+
    fg('Fecha Emisión','<input class="form-control" id="fh-issue" type="date" value="'+(h.issueDate||toISO(today0()))+'">')+
    fg('Fecha Vencimiento *','<input class="form-control" id="fh-expiry" type="date" value="'+(h.expiryDate||'')+'">')+
    '<div class="form-group full">'+fl('Observaciones')+'<textarea class="form-control" id="fh-obs" rows="2">'+esc(h.observations||'')+'</textarea></div>'+
    '</div>';
}

function addHaz() {
  openModal('Nuevo Registro', hazFormHtml(null), function(){
    var type=document.getElementById('fh-type').value;
    var expiry=document.getElementById('fh-expiry').value;
    if(!expiry){toast('Ingrese la fecha de vencimiento','error');return false;}
    var body={type:type,entityName:document.getElementById('fh-entity').value.trim(),
      permitNumber:document.getElementById('fh-permit').value.trim()||undefined,
      issuingAuthority:document.getElementById('fh-auth').value.trim()||undefined,
      issueDate:document.getElementById('fh-issue').value||undefined,
      expiryDate:expiry,
      observations:document.getElementById('fh-obs').value||undefined};
    return apiJson('/hazardous-documents',{method:'POST',body:JSON.stringify(body)})
    .then(function(h){
      App.hazardous.push(normalizeHazardous(h));
      toast('Registro agregado'); closeModal(); renderHazardous(); updateBadges();
    }).catch(function(err){toast(err.message||'Error al guardar','error');});
  });
}

function editHaz(id) {
  var h=App.hazardous.find(function(x){return x.id===id;});
  if(!h) return;
  openModal('Editar Registro', hazFormHtml(h), function(){
    var expiry=document.getElementById('fh-expiry').value;
    if(!expiry){toast('Ingrese la fecha de vencimiento','error');return false;}
    var body={type:document.getElementById('fh-type').value,
      entityName:document.getElementById('fh-entity').value.trim(),
      permitNumber:document.getElementById('fh-permit').value.trim()||null,
      issuingAuthority:document.getElementById('fh-auth').value.trim()||null,
      issueDate:document.getElementById('fh-issue').value||null,
      expiryDate:expiry,
      observations:document.getElementById('fh-obs').value||null};
    return apiJson('/hazardous-documents/'+id,{method:'PATCH',body:JSON.stringify(body)})
    .then(function(updated){
      var idx=App.hazardous.findIndex(function(x){return x.id===id;});
      if(idx!==-1) App.hazardous[idx]=normalizeHazardous(updated);
      toast('Registro actualizado'); closeModal(); renderHazardous(); updateBadges();
    }).catch(function(err){toast(err.message||'Error al actualizar','error');});
  });
}

function delHaz(id) {
  if(!isAdmin()){toast('Sin permisos para eliminar','error');return;}
  var h=App.hazardous.find(function(x){return x.id===id;});
  if(!h||!confirm('¿Eliminar "'+h.type+'"?')) return;
  apiJson('/hazardous-documents/'+id,{method:'DELETE'})
  .then(function(){
    App.hazardous=App.hazardous.filter(function(x){return x.id!==id;});
    toast('Registro eliminado','warning'); renderHazardous(); updateBadges();
  }).catch(function(err){toast(err.message||'Error al eliminar','error');});
}

// ─── CALENDAR ────────────────────────────────────────────────
function renderCalendar() {
  var el=document.getElementById('view-calendar');
  if(!el) return;
  var yr=App.calYear, mo=App.calMonth;
  var months=['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];
  var days=['Dom','Lun','Mar','Mié','Jue','Vie','Sáb'];
  var firstDay=new Date(yr,mo,1).getDay();
  var dIM=new Date(yr,mo+1,0).getDate();
  var dIPM=new Date(yr,mo,0).getDate();
  var todayStr=toISO(today0());
  var allE=[].concat(
    App.expirations.map(function(e){return {date:e.expiryDate,title:e.type,status:getStatus(e.expiryDate)};}),
    App.hazardous.map(function(h){return {date:h.expiryDate,title:h.type,status:getStatus(h.expiryDate)};})
  );

  function dayKey(y,m,d){ return y+'-'+String(m+1).padStart(2,'0')+'-'+String(d).padStart(2,'0'); }
  function dayEvents(y,m,d){ var k=dayKey(y,m,d); return allE.filter(function(e){return e.date===k;}); }

  var cells='';
  for(var i=firstDay-1;i>=0;i--) cells+='<div class="calendar-day other-month"><div class="day-num">'+(dIPM-i)+'</div></div>';
  for(var day=1;day<=dIM;day++) {
    var iso=dayKey(yr,mo,day);
    var isT=iso===todayStr;
    var evts=dayEvents(yr,mo,day);
    var evtsHtml=evts.slice(0,3).map(function(e){
      return '<div class="day-event '+e.status+'" title="'+esc(e.title)+'">'+esc(e.title)+'</div>';
    }).join('')+(evts.length>3?'<div style="font-size:10px;color:#94a3b8;padding:1px 4px">+'+(evts.length-3)+' más</div>':'');
    cells+='<div class="calendar-day'+(isT?' today':'')+'"><div class="day-num'+(isT?' today-num':'')+'">'+day+'</div><div class="day-events">'+evtsHtml+'</div></div>';
  }
  var total=Math.ceil((firstDay+dIM)/7)*7;
  for(var j=1;j<=total-firstDay-dIM;j++) cells+='<div class="calendar-day other-month"><div class="day-num">'+j+'</div></div>';

  el.innerHTML=
    '<div class="page-header"><div><div class="page-title">Calendario de Vencimientos</div>'+
    '<div class="page-subtitle">Vista mensual · Click en el día para ver detalles</div></div></div>'+
    '<div class="calendar-wrapper">'+
    '<div class="calendar-header">'+
    '<button class="calendar-nav-btn btn-ghost btn-sm" onclick="calNav(-1)">← Anterior</button>'+
    '<span class="calendar-month-title">'+months[mo]+' '+yr+'</span>'+
    '<button class="calendar-nav-btn btn-ghost btn-sm" onclick="calNav(1)">Siguiente →</button>'+
    '</div>'+
    '<div class="calendar-grid">'+
    days.map(function(d){return '<div class="calendar-day-header">'+d+'</div>';}).join('')+
    cells+'</div></div>';
}

function calNav(dir) {
  App.calMonth+=dir;
  if(App.calMonth>11){App.calMonth=0;App.calYear++;}
  if(App.calMonth<0){App.calMonth=11;App.calYear--;}
  renderCalendar();
}

// ─── REPORTS ─────────────────────────────────────────────────
function renderReports() {
  var el=document.getElementById('view-reports');
  if(!el) return;
  el.innerHTML=
    '<div class="page-header"><div><div class="page-title">Reportes</div>'+
    '<div class="page-subtitle">Generación y exportación de informes operativos</div></div></div>'+
    '<div class="report-section">'+
    '<div class="report-controls">'+
    '<select class="filter-select" id="rep-type" onchange="buildReport()" style="min-width:240px">'+
    '<option value="expired">Documentos Vencidos</option>'+
    '<option value="next30">Próximos 30 días</option>'+
    '<option value="next60">Próximos 60 días</option>'+
    '<option value="vehicles">Vehículos con Alertas</option>'+
    '<option value="drivers">Choferes con Alertas</option>'+
    '<option value="all">Todos los Vencimientos</option>'+
    '</select>'+
    '<button class="btn-ghost" onclick="exportCSV()">'+
    '<svg width="15" height="15" viewBox="0 0 15 15" fill="none"><path d="M2 9v4h11V9M7.5 1.5V9M5 7l2.5 2.5L10 7" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg>'+
    ' Exportar CSV</button>'+
    '<button class="btn-primary" onclick="exportCSV(\'excel\')">'+
    '<svg width="15" height="15" viewBox="0 0 15 15" fill="none"><path d="M2 9v4h11V9M7.5 1.5V9M5 7l2.5 2.5L10 7" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg>'+
    ' Exportar Excel</button>'+
    '</div>'+
    '<div id="rep-preview"></div></div>'+

    '<div class="report-section" style="margin-top:20px">'+
    '<div class="section-title" style="font-size:15px;font-weight:700;color:#0f172a;margin-bottom:10px">Backup de Datos</div>'+
    '<p style="color:#64748b;font-size:13px;margin-bottom:14px">'+
    'Para llevar tus datos a otra PC: exportá el backup, copiá el archivo (USB, correo, Drive) y restauralo en la otra computadora.</p>'+
    '<div style="display:flex;gap:10px;flex-wrap:wrap;align-items:center">'+
    '<button class="btn-primary" onclick="exportBackup()">'+dlIcon()+' Exportar Backup</button>'+
    '<button class="btn-ghost" onclick="triggerImportBackup()">'+upIcon()+' Restaurar Backup</button>'+
    '<input type="file" id="backup-import-input" accept=".json" style="display:none" onchange="importBackup(this)">'+
    '</div>'+
    '<p style="color:#94a3b8;font-size:12px;margin-top:10px">'+
    'El backup exporta el historial local. Los datos del servidor (vehículos, choferes, vencimientos, residuos) se gestionan en la base de datos. El archivo es de tipo <strong>.json</strong> y solo lo lee esta aplicación.</p>'+
    '</div>';
  buildReport();
}

function buildReport() {
  var type=document.getElementById('rep-type')?document.getElementById('rep-type').value:'expired';
  App.reportType=type;
  var data=App.expirations.slice();
  if(type==='expired') data=data.filter(function(e){return getStatus(e.expiryDate)==='expired';});
  else if(type==='next30') data=data.filter(function(e){var d=getDays(e.expiryDate);return d>=0&&d<=30;});
  else if(type==='next60') data=data.filter(function(e){var d=getDays(e.expiryDate);return d>=0&&d<=60;});
  else if(type==='vehicles') data=data.filter(function(e){return e.vehicleId&&['expired','critical','warning'].includes(getStatus(e.expiryDate));});
  else if(type==='drivers') data=data.filter(function(e){return e.driverId&&['expired','critical','warning'].includes(getStatus(e.expiryDate));});
  data.sort(function(a,b){return getDays(a.expiryDate)-getDays(b.expiryDate);});
  App.reportData=data;
  var rows=data.map(function(e){
    var s=getStatus(e.expiryDate), d=getDays(e.expiryDate);
    var entity=e.vehicleId?getVehicleName(e.vehicleId):e.driverId?getDriverName(e.driverId):'Empresa';
    return '<tr><td>'+esc(e.type)+'</td>'+
      '<td><span class="badge badge-info">'+esc(CATS[e.category]||e.category)+'</span></td>'+
      '<td style="font-size:12px">'+esc(entity)+'</td>'+
      '<td>'+fmtDate(e.issueDate)+'</td>'+
      '<td>'+fmtDate(e.expiryDate)+'</td>'+
      '<td style="color:'+statusColor(s)+';font-weight:700">'+(d<0?'-'+Math.abs(d)+'d':d+'d')+'</td>'+
      '<td><span class="badge badge-'+s+'">'+statusLabel(s)+'</span></td></tr>';
  }).join('');
  var preview=document.getElementById('rep-preview');
  if(preview) preview.innerHTML=
    '<p style="font-size:12px;color:#94a3b8;margin-bottom:12px">'+data.length+' registro'+( data.length!==1?'s':'')+'</p>'+
    '<div class="table-wrapper" style="max-height:420px;overflow-y:auto"><table>'+
    '<thead><tr><th>Documento</th><th>Cat.</th><th>Entidad</th><th>Emisión</th><th>Vencimiento</th><th>Días</th><th>Estado</th></tr></thead>'+
    '<tbody>'+(rows||'<tr><td colspan="7" style="text-align:center;padding:32px;color:#94a3b8">Sin datos</td></tr>')+'</tbody></table></div>';
}

function exportCSV(fmt) {
  var data=App.reportData||[];
  var hdr=['Tipo','Categoría','Entidad','Fecha Emisión','Fecha Vencimiento','Días Restantes','Estado'];
  var rows=data.map(function(e){
    var d=getDays(e.expiryDate);
    var entity=e.vehicleId?getVehicleName(e.vehicleId):e.driverId?getDriverName(e.driverId):'Empresa';
    return [e.type,CATS[e.category]||e.category,entity,fmtDate(e.issueDate),fmtDate(e.expiryDate),
      d<0?'-'+Math.abs(d):String(d),statusLabel(getStatus(e.expiryDate))];
  });
  var csv='﻿'+[hdr].concat(rows).map(function(r){
    return r.map(function(c){return '"'+String(c||'').replace(/"/g,'""')+'"';}).join(',');
  }).join('\r\n');
  var blob=new Blob([csv],{type:'text/csv;charset=utf-8'});
  var url=URL.createObjectURL(blob);
  var a=document.createElement('a');
  a.href=url; a.download='logicontrol-reporte-'+toISO(today0())+'.csv';
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  URL.revokeObjectURL(url);
  toast('Reporte exportado ('+data.length+' registros)');
}

// ─── BACKUP ──────────────────────────────────────────────────

function exportBackup() {
  var backup = {
    version: '2',
    app: 'LOGICONTROL PRO',
    exportedAt: new Date().toISOString(),
    note: 'Vehicles, drivers, expirations and hazardous docs are stored on the server. This backup contains local history only.',
    history: App.history
  };
  var json = JSON.stringify(backup, null, 2);
  var blob = new Blob([json], {type:'application/json;charset=utf-8'});
  var url = URL.createObjectURL(blob);
  var a = document.createElement('a');
  a.href = url;
  a.download = 'logicontrol-backup-' + toISO(today0()) + '.json';
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  URL.revokeObjectURL(url);
  toast('Backup exportado — historial local ('+App.history.length+' registros)');
}

function triggerImportBackup() {
  var inp = document.getElementById('backup-import-input');
  if (!inp) return;
  inp.value = '';
  inp.click();
}

function importBackup(input) {
  var file = input.files[0];
  if (!file) return;
  var reader = new FileReader();
  reader.onload = function(ev) {
    var data;
    try { data = JSON.parse(ev.target.result); } catch(e) {
      toast('El archivo no es un backup válido', 'error'); return;
    }
    if (!data.app || data.app !== 'LOGICONTROL PRO') {
      toast('Archivo de backup inválido o corrupto', 'error'); return;
    }
    var historyCount = Array.isArray(data.history) ? data.history.length : 0;
    var msg = 'Restaurar historial local del backup del ' +
      fmtDate(data.exportedAt ? data.exportedAt.split('T')[0] : '') + '?\n\n' +
      '• ' + historyCount + ' registros de historial local\n\n' +
      'NOTA: Los datos del servidor (vehículos, choferes, vencimientos) no se modifican.';
    if (!confirm(msg)) return;
    App.history = data.history || [];
    saveAll();
    if (App.view === 'history') renderView('history');
    toast('Historial local restaurado — ' + App.history.length + ' registros');
  };
  reader.onerror = function() { toast('Error al leer el archivo', 'error'); };
  reader.readAsText(file, 'UTF-8');
}

// ─── HISTORY ─────────────────────────────────────────────────
function renderHistory() {
  var el=document.getElementById('view-history');
  if(!el) return;

  if(!isAdmin()){
    el.innerHTML=
      '<div class="page-header"><div><div class="page-title">Historial de Actividad</div>'+
      '<div class="page-subtitle">Registro de operaciones del sistema</div></div></div>'+
      '<div class="empty-state"><div class="empty-state-title">Sin permisos</div>'+
      '<div class="empty-state-desc">Solo los administradores pueden ver el historial de actividad.</div></div>';
    return;
  }

  var actionLbl={CREATE:'Alta',UPDATE:'Modificación',DELETE:'Baja',RENEW:'Renovación'};
  var actionBg={CREATE:'#dcfce7',UPDATE:'#dbeafe',DELETE:'#fee2e2',RENEW:'#fef9c3'};
  var actionTxt={CREATE:'#15803d',UPDATE:'#1d4ed8',DELETE:'#b91c1c',RENEW:'#854d0e'};

  var q=(App.historySearch||'').toLowerCase();
  var data=App.auditLogs;
  if(q) data=data.filter(function(h){
    return (h.action||'').toLowerCase().includes(q)||
           (h.entityType||'').toLowerCase().includes(q)||
           (h.entityId||'').toLowerCase().includes(q)||
           (h.metadata&&JSON.stringify(h.metadata).toLowerCase().includes(q));
  });

  var legacyBanner=App.history.length>0?
    '<div style="background:#fef9c3;border:1px solid #fde68a;border-radius:8px;padding:12px 16px;margin-bottom:16px;font-size:13px;color:#854d0e">'+
    '<strong>Aviso:</strong> Hay '+App.history.length+' registros del historial local anterior. Estos no se muestran aquí y no se eliminan automáticamente.</div>':
    '';

  var items=data.length?data.map(function(h){
    var act=(h.action||'').toUpperCase();
    var bg=actionBg[act]||'#f1f5f9', tc=actionTxt[act]||'#475569';
    var lbl=actionLbl[act]||h.action||'—';
    var meta=h.metadata&&h.metadata.userEmail?'<span style="font-size:11px;color:#94a3b8"> · '+esc(h.metadata.userEmail)+'</span>':'';
    var desc=esc(h.entityType||'')+(h.entityId?' #'+esc(String(h.entityId).slice(0,8)):'');
    return '<div class="history-item">'+
      '<div class="history-icon">'+
      '<svg width="16" height="16" viewBox="0 0 16 16" fill="none"><circle cx="8" cy="8" r="6" stroke="#2563eb" stroke-width="1.4"/><path d="M8 5v3l2 2" stroke="#2563eb" stroke-width="1.4" stroke-linecap="round"/></svg>'+
      '</div>'+
      '<div class="history-content">'+
      '<div class="history-action">'+desc+meta+'</div>'+
      '<div class="history-meta">'+
      '<span class="history-type-badge" style="background:'+bg+';color:'+tc+'">'+lbl+'</span>'+
      '<span class="history-time">'+fmtDT(h.createdAt||h.timestamp)+'</span>'+
      '</div></div></div>';
  }).join(''):'<div class="empty-state"><div class="empty-state-title">Sin actividad registrada</div></div>';

  el.innerHTML=
    '<div class="page-header"><div><div class="page-title">Historial de Actividad</div>'+
    '<div class="page-subtitle">'+App.auditLogs.length+' registros del servidor</div></div></div>'+
    legacyBanner+
    '<div class="filter-row"><input type="text" class="filter-input" placeholder="Buscar en historial..." value="'+esc(App.historySearch||'')+'" oninput="filterHistory(this.value)"></div>'+
    '<div class="history-list">'+items+'</div>';
}

function filterHistory(v) { App.historySearch=v; renderHistory(); }

// ─── ADMIN ───────────────────────────────────────────────────
function loadAdminData() {
  var user = UserStore ? UserStore.get() : null;
  if (!user) return Promise.resolve();
  var tasks = [apiJson('/users?limit=100')];
  if (user.role === 'SUPER_ADMIN') tasks.push(apiJson('/companies'));
  return Promise.allSettled(tasks).then(function(results) {
    if (results[0].status === 'fulfilled') App.adminUsers = results[0].value || [];
    if (results[1] && results[1].status === 'fulfilled') App.companies = results[1].value || [];
  });
}

function setAdminTab(tab) { App.adminTab = tab; renderAdmin(); }

function renderAdmin() {
  var el = document.getElementById('view-admin');
  if (!el) return;
  var user = UserStore ? UserStore.get() : null;
  if (!user) return;
  var isSA = user.role === 'SUPER_ADMIN';
  var isCA = user.role === 'COMPANY_ADMIN';
  if (!isSA && !isCA && user.role !== 'USER') { el.innerHTML = ''; return; }

  var tabs = [];
  if (isSA) tabs.push({ id: 'companies', label: 'Empresas' });
  if (isSA || isCA) tabs.push({ id: 'users', label: 'Usuarios' });
  tabs.push({ id: 'password', label: 'Mi Contraseña' });

  var validTabs = tabs.map(function(t){ return t.id; });
  if (validTabs.indexOf(App.adminTab) === -1) App.adminTab = validTabs[0];

  var tabsHtml = tabs.map(function(t) {
    return '<button class="btn-tab'+(App.adminTab===t.id?' active':'')+'" onclick="setAdminTab(\''+t.id+'\')">'+esc(t.label)+'</button>';
  }).join('');

  var body = '';
  if (App.adminTab === 'companies') body = renderAdminCompanies();
  else if (App.adminTab === 'users') body = renderAdminUsers();
  else body = renderAdminPassword();

  el.innerHTML =
    '<div class="page-header"><div><div class="page-title">Administración</div>'+
    '<div class="page-subtitle">Gestión de usuarios y empresas</div></div></div>'+
    '<div class="tab-bar">'+tabsHtml+'</div>'+
    '<div class="admin-body">'+body+'</div>';
}

function renderAdminCompanies() {
  var rows = App.companies.length ? App.companies.map(function(c) {
    var statusCls = c.active ? 'badge-ok' : 'badge-expired';
    var statusTxt = c.active ? 'Activa' : 'Inactiva';
    return '<tr>'+
      '<td>'+esc(c.name)+'</td>'+
      '<td>'+esc(c.taxId||'—')+'</td>'+
      '<td><span class="badge '+statusCls+'">'+statusTxt+'</span></td>'+
      '<td>'+fmtDate(c.createdAt)+'</td>'+
      '<td>'+
        '<button class="btn-sm btn-ghost" onclick="editCompany(\''+c.id+'\')">Editar</button> '+
        '<button class="btn-sm btn-ghost" onclick="toggleCompanyStatus(\''+c.id+'\','+(!c.active)+')">'+(c.active?'Desactivar':'Activar')+'</button>'+
      '</td></tr>';
  }).join('') : '<tr><td colspan="5" style="text-align:center;color:#94a3b8">No hay empresas registradas</td></tr>';

  return '<div style="display:flex;justify-content:flex-end;margin-bottom:12px">'+
    '<button class="btn-primary" onclick="addCompany()">+ Nueva Empresa</button></div>'+
    '<div class="table-wrap"><table class="data-table">'+
    '<thead><tr><th>Nombre</th><th>CUIT/CUIL</th><th>Estado</th><th>Fecha Alta</th><th>Acciones</th></tr></thead>'+
    '<tbody>'+rows+'</tbody></table></div>';
}

function renderAdminUsers() {
  var rows = App.adminUsers.length ? App.adminUsers.map(function(u) {
    var statusCls = u.active ? 'badge-ok' : 'badge-expired';
    var statusTxt = u.active ? 'Activo' : 'Inactivo';
    var roleLabels = { SUPER_ADMIN: 'Super Admin', COMPANY_ADMIN: 'Admin', USER: 'Usuario' };
    return '<tr>'+
      '<td>'+esc(u.firstName+' '+u.lastName)+'</td>'+
      '<td>'+esc(u.email)+'</td>'+
      '<td><span class="badge badge-ok" style="background:#dbeafe;color:#1d4ed8">'+esc(roleLabels[u.role]||u.role)+'</span></td>'+
      '<td><span class="badge '+statusCls+'">'+statusTxt+'</span></td>'+
      '<td>'+
        '<button class="btn-sm btn-ghost" onclick="adminEditUser(\''+u.id+'\')">Editar</button> '+
        '<button class="btn-sm btn-ghost" onclick="adminToggleUser(\''+u.id+'\','+(!u.active)+')">'+(u.active?'Desactivar':'Activar')+'</button> '+
        '<button class="btn-sm btn-ghost" onclick="adminResetPwd(\''+u.id+'\')">Reset Clave</button>'+
      '</td></tr>';
  }).join('') : '<tr><td colspan="5" style="text-align:center;color:#94a3b8">No hay usuarios</td></tr>';

  return '<div style="display:flex;justify-content:flex-end;margin-bottom:12px">'+
    '<button class="btn-primary" onclick="adminAddUser()">+ Nuevo Usuario</button></div>'+
    '<div class="table-wrap"><table class="data-table">'+
    '<thead><tr><th>Nombre</th><th>Email</th><th>Rol</th><th>Estado</th><th>Acciones</th></tr></thead>'+
    '<tbody>'+rows+'</tbody></table></div>';
}

function renderAdminPassword() {
  return '<div style="max-width:420px">'+
    '<h3 style="margin:0 0 16px;font-size:16px;font-weight:600">Cambiar contraseña</h3>'+
    '<div class="form-group"><label>Contraseña actual</label>'+
    '<input type="password" id="adm-pwd-current" class="form-control" autocomplete="current-password"></div>'+
    '<div class="form-group"><label>Nueva contraseña</label>'+
    '<input type="password" id="adm-pwd-new" class="form-control" autocomplete="new-password"></div>'+
    '<div class="form-group"><label>Confirmar nueva contraseña</label>'+
    '<input type="password" id="adm-pwd-confirm" class="form-control" autocomplete="new-password"></div>'+
    '<p id="adm-pwd-error" style="color:#ef4444;font-size:13px;min-height:18px"></p>'+
    '<button class="btn-primary" onclick="adminChangePassword()">Cambiar contraseña</button>'+
    '</div>';
}

function addCompany() {
  openModal('Nueva Empresa',
    '<div class="form-group"><label>Nombre <span class="req">*</span></label><input id="m-co-name" class="form-control" maxlength="120"></div>'+
    '<div class="form-group"><label>CUIT/CUIL</label><input id="m-co-tax" class="form-control" maxlength="30"></div>',
    function() {
      var name = (document.getElementById('m-co-name').value||'').trim();
      if (!name) { toast('Nombre requerido','error'); return; }
      return apiJson('/companies', { method:'POST', body: JSON.stringify({ name:name, taxId: document.getElementById('m-co-tax').value.trim()||undefined }) })
        .then(function(c) {
          App.companies.push(c);
          closeModal();
          renderAdmin();
          toast('Empresa creada');
        })
        .catch(function(e) { toast(e.message||'Error al crear empresa','error'); });
    }
  );
}

function editCompany(id) {
  var c = App.companies.find(function(x){ return x.id===id; });
  if (!c) return;
  openModal('Editar Empresa',
    '<div class="form-group"><label>Nombre <span class="req">*</span></label><input id="m-co-name" class="form-control" maxlength="120" value="'+esc(c.name)+'"></div>'+
    '<div class="form-group"><label>CUIT/CUIL</label><input id="m-co-tax" class="form-control" maxlength="30" value="'+esc(c.taxId||'')+'"></div>',
    function() {
      var name = (document.getElementById('m-co-name').value||'').trim();
      if (!name) { toast('Nombre requerido','error'); return; }
      return apiJson('/companies/'+id, { method:'PATCH', body: JSON.stringify({ name:name, taxId: document.getElementById('m-co-tax').value.trim()||undefined }) })
        .then(function(updated) {
          var idx = App.companies.findIndex(function(x){ return x.id===id; });
          if (idx>=0) App.companies[idx] = updated;
          closeModal();
          renderAdmin();
          toast('Empresa actualizada');
        })
        .catch(function(e) { toast(e.message||'Error al actualizar','error'); });
    }
  );
}

function toggleCompanyStatus(id, active) {
  apiJson('/companies/'+id+'/status', { method:'PATCH', body: JSON.stringify({ active:active }) })
    .then(function(updated) {
      var idx = App.companies.findIndex(function(x){ return x.id===id; });
      if (idx>=0) App.companies[idx] = updated;
      renderAdmin();
      toast('Estado actualizado');
    })
    .catch(function(e) { toast(e.message||'Error','error'); });
}

function adminAddUser() {
  var user = UserStore ? UserStore.get() : null;
  var roleOpts = user && user.role==='SUPER_ADMIN'
    ? '<option value="USER">Usuario</option><option value="COMPANY_ADMIN">Admin Empresa</option><option value="SUPER_ADMIN">Super Admin</option>'
    : '<option value="USER">Usuario</option><option value="COMPANY_ADMIN">Admin Empresa</option>';
  var companyField = (user && user.role==='SUPER_ADMIN')
    ? '<div class="form-group"><label>Empresa <span class="req">*</span></label><select id="m-us-company" class="form-control">'+
      App.companies.map(function(c){ return '<option value="'+c.id+'">'+esc(c.name)+'</option>'; }).join('')+
      '</select></div>'
    : '';
  openModal('Nuevo Usuario',
    companyField+
    '<div class="form-group"><label>Nombre <span class="req">*</span></label><input id="m-us-fname" class="form-control" maxlength="60"></div>'+
    '<div class="form-group"><label>Apellido <span class="req">*</span></label><input id="m-us-lname" class="form-control" maxlength="60"></div>'+
    '<div class="form-group"><label>Email <span class="req">*</span></label><input id="m-us-email" class="form-control" type="email"></div>'+
    '<div class="form-group"><label>Contraseña <span class="req">*</span></label><input id="m-us-pwd" class="form-control" type="password" minlength="8"></div>'+
    '<div class="form-group"><label>Rol</label><select id="m-us-role" class="form-control">'+roleOpts+'</select></div>',
    function() {
      var fname = (document.getElementById('m-us-fname').value||'').trim();
      var lname = (document.getElementById('m-us-lname').value||'').trim();
      var email = (document.getElementById('m-us-email').value||'').trim();
      var pwd   = document.getElementById('m-us-pwd').value;
      var role  = document.getElementById('m-us-role').value;
      var coEl  = document.getElementById('m-us-company');
      if (!fname||!lname||!email||!pwd) { toast('Completá todos los campos requeridos','error'); return; }
      if (pwd.length<8) { toast('La contraseña debe tener al menos 8 caracteres','error'); return; }
      var payload = { firstName:fname, lastName:lname, email:email, password:pwd, role:role };
      if (coEl) payload.companyId = coEl.value;
      return apiJson('/users', { method:'POST', body: JSON.stringify(payload) })
        .then(function(u) {
          App.adminUsers.push(u);
          closeModal();
          renderAdmin();
          toast('Usuario creado');
        })
        .catch(function(e) { toast(e.message||'Error al crear usuario','error'); });
    }
  );
}

function adminEditUser(id) {
  var u = App.adminUsers.find(function(x){ return x.id===id; });
  if (!u) return;
  openModal('Editar Usuario',
    '<div class="form-group"><label>Nombre</label><input id="m-us-fname" class="form-control" maxlength="60" value="'+esc(u.firstName)+'"></div>'+
    '<div class="form-group"><label>Apellido</label><input id="m-us-lname" class="form-control" maxlength="60" value="'+esc(u.lastName)+'"></div>'+
    '<div class="form-group"><label>Email</label><input id="m-us-email" class="form-control" type="email" value="'+esc(u.email)+'"></div>',
    function() {
      var data = {};
      var fname = (document.getElementById('m-us-fname').value||'').trim();
      var lname = (document.getElementById('m-us-lname').value||'').trim();
      var email = (document.getElementById('m-us-email').value||'').trim();
      if (fname) data.firstName = fname;
      if (lname) data.lastName = lname;
      if (email) data.email = email;
      return apiJson('/users/'+id, { method:'PATCH', body: JSON.stringify(data) })
        .then(function(updated) {
          var idx = App.adminUsers.findIndex(function(x){ return x.id===id; });
          if (idx>=0) App.adminUsers[idx] = updated;
          closeModal();
          renderAdmin();
          toast('Usuario actualizado');
        })
        .catch(function(e) { toast(e.message||'Error al actualizar','error'); });
    }
  );
}

function adminToggleUser(id, active) {
  apiJson('/users/'+id+'/status', { method:'PATCH', body: JSON.stringify({ active:active }) })
    .then(function(updated) {
      var idx = App.adminUsers.findIndex(function(x){ return x.id===id; });
      if (idx>=0) App.adminUsers[idx] = updated;
      renderAdmin();
      toast('Estado actualizado');
    })
    .catch(function(e) { toast(e.message||'Error','error'); });
}

function adminResetPwd(id) {
  openModal('Restablecer Contraseña',
    '<p style="margin:0 0 12px;font-size:13px;color:#64748b">Se establecerá una nueva contraseña para este usuario.</p>'+
    '<div class="form-group"><label>Nueva contraseña <span class="req">*</span></label><input id="m-rst-pwd" class="form-control" type="password" minlength="8"></div>'+
    '<div class="form-group"><label>Confirmar contraseña</label><input id="m-rst-pwd2" class="form-control" type="password" minlength="8"></div>',
    function() {
      var pwd  = document.getElementById('m-rst-pwd').value;
      var pwd2 = document.getElementById('m-rst-pwd2').value;
      if (!pwd||pwd.length<8) { toast('Mínimo 8 caracteres','error'); return; }
      if (pwd!==pwd2) { toast('Las contraseñas no coinciden','error'); return; }
      return apiJson('/users/'+id+'/reset-password', { method:'POST', body: JSON.stringify({ newPassword:pwd }) })
        .then(function() { closeModal(); toast('Contraseña restablecida'); })
        .catch(function(e) { toast(e.message||'Error','error'); });
    }
  );
}

function adminChangePassword() {
  var current = (document.getElementById('adm-pwd-current')||{}).value;
  var newPwd  = (document.getElementById('adm-pwd-new')||{}).value;
  var confirm = (document.getElementById('adm-pwd-confirm')||{}).value;
  var errEl   = document.getElementById('adm-pwd-error');
  function setErr(msg){ if(errEl) errEl.textContent = msg||''; }
  setErr('');
  if (!current||!newPwd||!confirm) { setErr('Completá todos los campos'); return; }
  if (newPwd.length<8) { setErr('La contraseña nueva debe tener al menos 8 caracteres'); return; }
  if (newPwd!==confirm) { setErr('Las contraseñas no coinciden'); return; }
  apiJson('/users/me/change-password', { method:'POST', body: JSON.stringify({ currentPassword:current, newPassword:newPwd }) })
    .then(function() {
      document.getElementById('adm-pwd-current').value='';
      document.getElementById('adm-pwd-new').value='';
      document.getElementById('adm-pwd-confirm').value='';
      toast('Contraseña actualizada');
    })
    .catch(function(e) { setErr(e.message||'Error al cambiar la contraseña'); });
}

// ─── SEARCH ──────────────────────────────────────────────────
function doSearch(q) {
  var dd=document.getElementById('search-results');
  if(!dd) return;
  if(!q||q.length<2){dd.style.display='none';return;}
  q=q.toLowerCase();
  var results=[];
  App.vehicles.filter(function(v){
    return (v.patent||'').toLowerCase().includes(q)||(v.brand||'').toLowerCase().includes(q)||(v.model||'').toLowerCase().includes(q);
  }).slice(0,4).forEach(function(v){results.push({type:'vehicles',label:v.patent,sub:v.brand+' '+v.model});});
  App.drivers.filter(function(d){
    return (d.name+' '+d.lastName).toLowerCase().includes(q)||(d.dni||'').includes(q);
  }).slice(0,4).forEach(function(d){results.push({type:'drivers',label:d.name+' '+d.lastName,sub:'DNI '+(d.dni||'')});});
  App.expirations.filter(function(e){
    return (e.type||'').toLowerCase().includes(q);
  }).slice(0,4).forEach(function(e){results.push({type:'expirations',label:e.type,sub:CATS[e.category]||'Doc' +' · '+fmtDate(e.expiryDate)});});

  if(!results.length){dd.innerHTML='<div style="padding:14px;color:#94a3b8;font-size:13px">Sin resultados para "'+esc(q)+'"</div>';dd.style.display='block';return;}
  dd.innerHTML=results.map(function(r){
    return '<div class="search-item" onclick="navigate(\''+r.type+'\');closeSearch()">'+
      '<div><div class="search-item-title">'+esc(r.label)+'</div><div class="search-item-sub">'+esc(r.sub)+'</div></div></div>';
  }).join('');
  dd.style.display='block';
}

function closeSearch() {
  var dd=document.getElementById('search-results');
  var inp=document.getElementById('search-input');
  if(dd) dd.style.display='none';
  if(inp) inp.value='';
}

// ─── FORM HELPERS ────────────────────────────────────────────
function fg(lbl,ctrl) { return '<div class="form-group">'+fl(lbl)+ctrl+'</div>'; }
function fl(lbl) { return '<label class="form-label">'+lbl+'</label>'; }
function editIcon() {
  return '<svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M9.5 1.5l3 3L4 13H1V10L9.5 1.5Z" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/></svg>';
}
function delIcon() {
  return '<svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M1.5 3.5h11M4.5 3.5V2.5C4.5 2 5 1.5 5.5 1.5h3C9 1.5 9.5 2 9.5 2.5V3.5M5 6v4M9 6v4M2.5 3.5L3.5 12.5H10.5L11.5 3.5" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg>';
}
function plusIcon() {
  return '<svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M7 1.5V12.5M1.5 7H12.5" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>';
}
function renewIcon() {
  return '<svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M1.5 7A5.5 5.5 0 0 1 12 4M12.5 7A5.5 5.5 0 0 1 2 10" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/><path d="M10 4h2V2" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg>';
}
function dlIcon() {
  return '<svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M7 1v8M4.5 6.5L7 9l2.5-2.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/><path d="M2 11.5h10" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>';
}
function upIcon() {
  return '<svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M7 9V1M4.5 3.5L7 1l2.5 2.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/><path d="M2 11.5h10" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>';
}

// ─── INIT ────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', function() {
  loadAll();

  // Nav links
  document.querySelectorAll('.nav-link').forEach(function(link) {
    link.addEventListener('click', function(e) {
      e.preventDefault();
      var v=link.getAttribute('data-view');
      if(v) navigate(v);
    });
  });

  // Hamburger
  var ham=document.getElementById('hamburger');
  var sid=document.getElementById('sidebar');
  var ov=document.getElementById('sidebar-overlay');
  if(ham&&sid) {
    ham.addEventListener('click', function() {
      sid.classList.toggle('open');
      if(ov) ov.classList.toggle('active');
    });
  }
  if(ov) ov.addEventListener('click', closeSidebar);

  // Modal
  var mClose=document.getElementById('modal-close-btn');
  var mCancel=document.getElementById('modal-cancel');
  var mSave=document.getElementById('modal-save');
  var mOv=document.getElementById('modal-overlay');
  if(mClose) mClose.addEventListener('click', closeModal);
  if(mCancel) mCancel.addEventListener('click', closeModal);
  if(mOv) mOv.addEventListener('click', function(e){ if(e.target===mOv) closeModal(); });
  if(mSave) mSave.addEventListener('click', function() {
    if(!App.modalCb) { closeModal(); return; }
    var r=App.modalCb();
    if(r===false) return;
    if(r&&typeof r.then==='function') {
      mSave.disabled=true;
      r.catch(function(){}).finally(function(){ mSave.disabled=false; });
    }
  });

  // Search
  var si=document.getElementById('search-input');
  var sd=document.getElementById('search-results');
  if(si) {
    si.addEventListener('input', function(){ doSearch(si.value); });
    si.addEventListener('keydown', function(e){ if(e.key==='Escape') closeSearch(); });
  }
  document.addEventListener('click', function(e) {
    if(si&&!si.contains(e.target)&&sd&&!sd.contains(e.target)) closeSearch();
  });

  // Start
  initLoginForm();
  checkSession().then(function(user) {
    if (!user) return;
    loadApiData().then(function() { navigate('dashboard'); });
  });
});

// Expose to global for onclick handlers
window.navigate     = navigate;
window.setAlertTab  = setAlertTab;
window.filterVehicles = filterVehicles;
window.addVehicle   = addVehicle;
window.editVehicle  = editVehicle;
window.delVehicle   = delVehicle;
window.restoreVehicle = restoreVehicle;
window.filterDrivers = filterDrivers;
window.addDriver    = addDriver;
window.editDriver   = editDriver;
window.delDriver    = delDriver;
window.restoreDriver = restoreDriver;
window.setExpFilter = setExpFilter;
window.addExp       = addExp;
window.editExp      = editExp;
window.renewExp     = renewExp;
window.delExp       = delExp;
window.addHaz       = addHaz;
window.editHaz      = editHaz;
window.delHaz       = delHaz;
window.calNav       = calNav;
window.buildReport  = buildReport;
window.exportCSV    = exportCSV;
window.filterHistory    = filterHistory;
window.setAdminTab      = setAdminTab;
window.addCompany       = addCompany;
window.editCompany      = editCompany;
window.toggleCompanyStatus = toggleCompanyStatus;
window.adminAddUser     = adminAddUser;
window.adminEditUser    = adminEditUser;
window.adminToggleUser  = adminToggleUser;
window.adminResetPwd    = adminResetPwd;
window.adminChangePassword = adminChangePassword;
window.closeSearch      = closeSearch;
window.downloadTemplate  = downloadTemplate;
window.triggerImportCSV  = triggerImportCSV;
window.importCSVFile     = importCSVFile;
window.exportBackup      = exportBackup;
window.triggerImportBackup = triggerImportBackup;
window.importBackup      = importBackup;
