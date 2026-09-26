const SUPABASE_URL = "https://wmqjlbrgdjgfjwopekup.supabase.co";
const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_N3BSrFZfEidi-nN8hYbWFg_WbjMMsDn";
const TABLE = "center_play_sessions_demo";

const db = supabase.createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY);
let sessionsCache = [];
let printableSession = null;

const $ = (id) => document.getElementById(id);
const esc = (s="") => String(s).replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
const fmt = (d) => new Intl.DateTimeFormat("ar-SA",{hour:"numeric",minute:"2-digit"}).format(new Date(d));

function showNotice(id, text, error=false){
  const el=$(id); el.textContent=text; el.classList.remove("hidden","error");
  if(error) el.classList.add("error");
}

function normalizePhone(raw){
  let d = String(raw||"").replace(/\D/g,"");
  if(d.startsWith("00966")) d=d.slice(2);
  if(d.startsWith("05") && d.length===10) d="966"+d.slice(1);
  else if(d.startsWith("5") && d.length===9) d="966"+d;
  return d;
}

function remainingInfo(row){
  const ms = new Date(row.ends_at).getTime() - Date.now();
  if(ms <= 0) return {red:true,label:"انتهى الوقت",text:"00:00"};
  const totalSec = Math.floor(ms/1000);
  const h = Math.floor(totalSec/3600);
  const m = Math.floor((totalSec%3600)/60);
  const s = totalSec%60;
  const text = (h ? `${String(h).padStart(2,"0")}:` : "") + `${String(m).padStart(2,"0")}:${String(s).padStart(2,"0")}`;
  const red = ms <= 10*60*1000;
  return {red,label:red ? "قرب يخلص" : "ساري",text};
}

async function refreshAuthUI(){
  const {data:{session}} = await db.auth.getSession();
  const logged = !!session;
  $("authView").classList.toggle("hidden", logged);
  $("appView").classList.toggle("hidden", !logged);
  $("logoutBtn").classList.toggle("hidden", !logged);
  if(logged) await loadSessions();
}

$("loginBtn").onclick = async () => {
  const email=$("email").value.trim(), password=$("password").value;
  if(!email || !password) return showNotice("authMsg","اكتب البريد وكلمة المرور.",true);
  const {error}=await db.auth.signInWithPassword({email,password});
  if(error) return showNotice("authMsg",error.message,true);
  showNotice("authMsg","تم تسجيل الدخول.");
  await refreshAuthUI();
};

$("signupBtn").onclick = async () => {
  const email=$("email").value.trim(), password=$("password").value;
  if(!email || password.length<8) return showNotice("authMsg","اكتب بريدًا صحيحًا وكلمة مرور 8 أحرف على الأقل.",true);
  const {data,error}=await db.auth.signUp({email,password});
  if(error) return showNotice("authMsg",error.message,true);
  if(data.session){
    showNotice("authMsg","تم إنشاء الحساب وتسجيل الدخول.");
    await refreshAuthUI();
  }else{
    showNotice("authMsg","تم إنشاء الحساب. افتح رسالة التأكيد في بريدك ثم سجل الدخول.");
  }
};

$("logoutBtn").onclick = async () => {
  await db.auth.signOut();
  await refreshAuthUI();
};

$("centerName").value = localStorage.getItem("centerName") || "مركز الترفيه";
$("centerName").addEventListener("input", () => localStorage.setItem("centerName",$("centerName").value.trim()));

$("childForm").addEventListener("submit", async (e)=>{
  e.preventDefault();
  const child_name=$("childName").value.trim();
  const guardian_name=$("guardianName").value.trim() || null;
  const guardian_phone=$("guardianPhone").value.trim();
  const duration_minutes=Number($("duration").value);
  if(!child_name || !guardian_phone) return showNotice("formMsg","اسم الطفل ورقم الجوال مطلوبان.",true);

  const starts = new Date();
  const ends = new Date(starts.getTime()+duration_minutes*60000);
  const qr_code = `CTR-${Date.now().toString(36).toUpperCase()}-${crypto.randomUUID().slice(0,6).toUpperCase()}`;

  const {data,error}=await db.from(TABLE).insert({
    child_name,guardian_name,guardian_phone,duration_minutes,
    starts_at:starts.toISOString(),ends_at:ends.toISOString(),qr_code
  }).select().single();

  if(error) return showNotice("formMsg","تعذر الحفظ: "+error.message,true);

  showNotice("formMsg","تم تسجيل الطفل وإنشاء الـQR.");
  $("childForm").reset();
  $("duration").value="60";
  setPrintable(data,true);
  await loadSessions();
});

function renderQr(targetId, code, size=118){
  const el=$(targetId); el.innerHTML="";
  new QRCode(el,{text:code,width:size,height:size,correctLevel:QRCode.CorrectLevel.M});
}

function setPrintable(row, showPanel=false){
  printableSession=row;
  $("previewChild").textContent=row.child_name;
  $("previewCode").textContent=row.qr_code;
  $("previewEnd").textContent="ينتهي: "+fmt(row.ends_at);
  renderQr("qrPreview",row.qr_code,120);

  $("printChild").textContent=row.child_name;
  $("printCode").textContent=row.qr_code;
  $("printEnd").textContent="حتى "+fmt(row.ends_at);
  renderQr("printQr",row.qr_code,110);

  if(showPanel) $("latestPanel").classList.remove("hidden");
}

function printRow(row){
  setPrintable(row,true);
  setTimeout(()=>window.print(),120);
}

$("printLatestBtn").onclick=()=> printableSession && printRow(printableSession);

async function openWelcome(row){
  const phone=normalizePhone(row.guardian_phone);
  if(phone.length<8){
    alert("رقم الجوال غير صالح.");
    return;
  }
  const center=$("centerName").value.trim() || "المركز";
  const msg=`مرحبًا بك في ${center} 🌟\nتم تسجيل دخول ${row.child_name} بنجاح.\nوقت الانتهاء المتوقع: ${fmt(row.ends_at)}.\nنتمنى لكم وقتًا ممتعًا.`;
  await db.from(TABLE).update({welcome_message_opened_at:new Date().toISOString()}).eq("id",row.id);
  window.open(`https://wa.me/${phone}?text=${encodeURIComponent(msg)}`,"_blank","noopener");
}

function renderSessions(){
  const wrap=$("sessions");
  if(!sessionsCache.length){
    wrap.innerHTML='<div class="muted">لا يوجد أطفال مسجلون بهذا الحساب حتى الآن.</div>';
    return;
  }
  wrap.innerHTML=sessionsCache.map(r=>{
    const info=remainingInfo(r);
    return `<article class="card ${info.red?'red':''}" data-id="${r.id}">
      <div class="card-head">
        <div>
          <div class="child">${esc(r.child_name)}</div>
          <div class="muted">${esc(r.guardian_name||"ولي الأمر")}</div>
        </div>
        <span class="status">${info.label}</span>
      </div>
      <div class="timer">${info.text}</div>
      <div class="meta">
        <div>الانتهاء: ${fmt(r.ends_at)}</div>
        <div>الجوال: <button class="phone-btn" data-phone="${r.id}">${esc(r.guardian_phone)}</button></div>
        <div>الكود: <span class="code">${esc(r.qr_code)}</span></div>
      </div>
      <div class="card-actions">
        <button class="btn secondary small" data-print="${r.id}">طباعة QR</button>
        <button class="btn ghost small" data-scan="${r.id}">عرض</button>
      </div>
    </article>`;
  }).join("");

  wrap.querySelectorAll("[data-phone]").forEach(b=>b.onclick=()=>openWelcome(sessionsCache.find(r=>r.id===b.dataset.phone)));
  wrap.querySelectorAll("[data-print]").forEach(b=>b.onclick=()=>printRow(sessionsCache.find(r=>r.id===b.dataset.print)));
  wrap.querySelectorAll("[data-scan]").forEach(b=>b.onclick=()=>showScanResult(sessionsCache.find(r=>r.id===b.dataset.scan)));
}

async function loadSessions(){
  const {data,error}=await db.from(TABLE).select("*").order("created_at",{ascending:false}).limit(100);
  if(error){
    $("sessions").innerHTML=`<div class="notice error">خطأ في تحميل البيانات: ${esc(error.message)}</div>`;
    return;
  }
  sessionsCache=data||[];
  renderSessions();
}

function showScanResult(row){
  const info=remainingInfo(row);
  const el=$("scanResult");
  el.classList.remove("hidden","red");
  if(info.red) el.classList.add("red");
  el.innerHTML=`<div class="scan-title">${esc(row.child_name)}</div>
    <div>الحالة: <strong>${info.label}</strong></div>
    <div>المتبقي: <strong dir="ltr">${info.text}</strong></div>
    <div>رقم ولي الأمر: <button id="scanPhone" class="phone-btn">${esc(row.guardian_phone)}</button></div>
    <div class="actions">
      <button id="scanPrint" class="btn secondary small">طباعة</button>
    </div>`;
  $("scanPhone").onclick=()=>openWelcome(row);
  $("scanPrint").onclick=()=>printRow(row);
}

$("scannerInput").addEventListener("keydown",async(e)=>{
  if(e.key!=="Enter") return;
  e.preventDefault();
  const code=e.target.value.trim();
  if(!code) return;
  const {data,error}=await db.from(TABLE).select("*").eq("qr_code",code).maybeSingle();
  e.target.value="";
  if(error || !data){
    const el=$("scanResult"); el.classList.remove("hidden"); el.classList.add("red");
    el.textContent="الكود غير موجود أو لا يخص هذا الحساب.";
    return;
  }
  showScanResult(data);
});

$("refreshBtn").onclick=loadSessions;

setInterval(()=>{
  if(sessionsCache.length) renderSessions();
  const currentCode=$("scannerInput").value;
  if(document.activeElement===$("scannerInput")) $("scannerInput").value=currentCode;
},1000);

db.auth.onAuthStateChange(()=>setTimeout(refreshAuthUI,0));
refreshAuthUI();
