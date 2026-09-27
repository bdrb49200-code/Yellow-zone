const SUPABASE_URL = "https://wmqjlbrgdjgfjwopekup.supabase.co";
const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_N3BSrFZfEidi-nN8hYbWFg_WbjMMsDn";
const TABLE = "center_play_sessions_demo";

const db = supabase.createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY);

/*
  حسابات التجربة فقط.
  تسجيل الدخول هنا محلي داخل المتصفح، وكلمات المرور ظاهرة في كود الموقع.
  قاعدة بيانات جدول التجربة متاحة للمفتاح العام كي تعمل النسخة بدون Supabase Auth.
  لا تستخدم هذا الأسلوب في النسخة النهائية.
*/
const DEMO_USERS = {
  badr: {
    password: "Badr1234",
    displayName: "بدر"
  },
  alaa: {
    password: "Alaa1234",
    displayName: "آلاء"
  },
  eman: {
    password: "Eman1234",
    displayName: "إيمان"
  }
};

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

  if(ms <= 0){
    return {state:"red",label:"انتهى الوقت",text:"00:00"};
  }

  const totalSec = Math.floor(ms/1000);
  const h = Math.floor(totalSec/3600);
  const m = Math.floor((totalSec%3600)/60);
  const s = totalSec%60;
  const text = (h ? `${String(h).padStart(2,"0")}:` : "") +
    `${String(m).padStart(2,"0")}:${String(s).padStart(2,"0")}`;

  if(ms <= 10*60*1000){
    return {state:"yellow",label:"قرب يخلص",text};
  }

  return {state:"green",label:"ساري",text};
}

async function refreshAuthUI(){
  const username = localStorage.getItem("demoUsername") || "";
  const logged = localStorage.getItem("demoLoggedIn") === "1" && !!DEMO_USERS[username];

  $("authView").classList.toggle("hidden", logged);
  $("appView").classList.toggle("hidden", !logged);
  $("logoutBtn").classList.toggle("hidden", !logged);

  if(logged){
    const user = DEMO_USERS[username];
    $("logoutBtn").textContent = `خروج — ${user.displayName}`;
    await loadSessions();
    await loadMonthlyHistory();
  }
}

$("loginBtn").onclick = async () => {
  const username = $("username").value.trim().toLowerCase();
  const password = $("password").value;
  const user = DEMO_USERS[username];

  if(!user){
    return showNotice("authMsg","اسم المستخدم غير صحيح. استخدم badr أو alaa أو eman.",true);
  }

  if(password !== user.password){
    return showNotice("authMsg","كلمة المرور غير صحيحة.",true);
  }

  localStorage.setItem("demoUsername",username);
  localStorage.setItem("demoLoggedIn","1");
  showNotice("authMsg","تم تسجيل الدخول.");
  await refreshAuthUI();
};

$("password").addEventListener("keydown",(e)=>{
  if(e.key==="Enter") $("loginBtn").click();
});

$("username").addEventListener("keydown",(e)=>{
  if(e.key==="Enter") $("password").focus();
});

$("logoutBtn").onclick = async () => {
  localStorage.removeItem("demoUsername");
  localStorage.removeItem("demoLoggedIn");
  $("username").value="";
  $("password").value="";
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
  await loadMonthlyHistory();
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
    return `<article class="card ${info.state}" data-id="${r.id}">
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
  el.classList.remove("hidden","red","yellow","green");
  el.classList.add(info.state);
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


function monthBounds(monthValue){
  const [year,month] = monthValue.split("-").map(Number);
  const from = new Date(year, month-1, 1, 0, 0, 0, 0);
  const to = new Date(year, month, 1, 0, 0, 0, 0);
  return {from:from.toISOString(), to:to.toISOString()};
}

function formatDateTime(value){
  return new Intl.DateTimeFormat("ar-SA",{
    year:"numeric",
    month:"2-digit",
    day:"2-digit",
    hour:"numeric",
    minute:"2-digit"
  }).format(new Date(value));
}

function minutesLabel(value){
  const n = Number(value || 0);
  if(n < 60) return `${n} دقيقة`;
  const h = Math.floor(n/60);
  const m = n % 60;
  return m ? `${h} ساعة و${m} دقيقة` : `${h} ساعة`;
}

function historyState(row){
  return remainingInfo(row);
}

let monthlyHistoryCache = [];

function renderMonthlyHistory(){
  const q = $("historySearch").value.trim().toLowerCase();

  const rows = monthlyHistoryCache.filter(r=>{
    if(!q) return true;
    return [
      r.child_name || "",
      r.guardian_name || "",
      r.guardian_phone || "",
      r.qr_code || ""
    ].some(v=>String(v).toLowerCase().includes(q));
  });

  $("historyCount").textContent = rows.length;
  $("historyMinutes").textContent = minutesLabel(
    rows.reduce((sum,r)=>sum + Number(r.duration_minutes || 0),0)
  );
  $("historyExpired").textContent =
    rows.filter(r=>new Date(r.ends_at).getTime() <= Date.now()).length;
  $("historyActive").textContent =
    rows.filter(r=>new Date(r.ends_at).getTime() > Date.now()).length;

  const body = $("historyBody");
  const empty = $("historyEmpty");

  if(!rows.length){
    body.innerHTML = "";
    empty.classList.remove("hidden");
    return;
  }

  empty.classList.add("hidden");

  body.innerHTML = rows.map(r=>{
    const st = historyState(r);
    return `<tr>
      <td>${esc(formatDateTime(r.created_at))}</td>
      <td><strong>${esc(r.child_name)}</strong></td>
      <td>${esc(r.guardian_name || "—")}</td>
      <td dir="ltr">${esc(r.guardian_phone)}</td>
      <td>${esc(minutesLabel(r.duration_minutes))}</td>
      <td>${esc(fmt(r.starts_at))}</td>
      <td>${esc(fmt(r.ends_at))}</td>
      <td><span class="history-status ${st.state}">${esc(st.label)}</span></td>
      <td>
        <button class="btn ghost small" type="button" data-history-open="${r.id}">عرض</button>
      </td>
    </tr>`;
  }).join("");

  body.querySelectorAll("[data-history-open]").forEach(btn=>{
    btn.onclick = ()=>{
      const row = monthlyHistoryCache.find(r=>r.id===btn.dataset.historyOpen);
      if(!row) return;
      showScanResult(row);
      $("scanResult").scrollIntoView({behavior:"smooth",block:"center"});
    };
  });
}

async function loadMonthlyHistory(){
  const month = $("historyMonth").value;
  if(!month) return;

  const {from,to} = monthBounds(month);

  const {data,error} = await db.from(TABLE)
    .select("*")
    .gte("created_at",from)
    .lt("created_at",to)
    .order("created_at",{ascending:false});

  if(error){
    $("historyBody").innerHTML =
      `<tr><td colspan="9"><div class="notice error">خطأ في تحميل السجل: ${esc(error.message)}</div></td></tr>`;
    return;
  }

  monthlyHistoryCache = data || [];
  renderMonthlyHistory();
}

const historyNow = new Date();
$("historyMonth").value =
  `${historyNow.getFullYear()}-${String(historyNow.getMonth()+1).padStart(2,"0")}`;

$("historyMonth").addEventListener("change",loadMonthlyHistory);
$("historySearch").addEventListener("input",renderMonthlyHistory);
$("historyRefreshBtn").onclick = loadMonthlyHistory;


$("scannerInput").addEventListener("keydown",async(e)=>{
  if(e.key!=="Enter") return;
  e.preventDefault();
  const code=e.target.value.trim();
  if(!code) return;
  const {data,error}=await db.from(TABLE).select("*").eq("qr_code",code).maybeSingle();
  e.target.value="";
  if(error || !data){
    const el=$("scanResult"); el.classList.remove("hidden"); el.classList.add("red");
    el.textContent="الكود غير موجود في قاعدة البيانات.";
    return;
  }
  showScanResult(data);
});

$("refreshBtn").onclick=async()=>{ await loadSessions(); await loadMonthlyHistory(); };

setInterval(()=>{
  if(sessionsCache.length) renderSessions();
  const currentCode=$("scannerInput").value;
  if(document.activeElement===$("scannerInput")) $("scannerInput").value=currentCode;
},1000);

refreshAuthUI();
