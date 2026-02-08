// PWA
if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("./sw.js").catch(()=>{});
}

// ---------- Storage ----------
const KEY = "study_anchor_v1";

const state = loadState();

function loadState(){
  const raw = localStorage.getItem(KEY);
  if(!raw){
    return {
      tasksByDay: {},     // { "YYYY-MM-DD": [{id,text,done,ts}] }
      doneDays: {},       // { "YYYY-MM-DD": true }
      weekLog: {},        // { "YYYY-WW": minutes }
      plans: [],          // [{id,subject,targetHours}]
      qa: []              // [{id,q,a,ts}]
    };
  }
  try { return JSON.parse(raw); } catch { return {}; }
}
function save(){
  localStorage.setItem(KEY, JSON.stringify(state));
}

// ---------- Date helpers ----------
function todayKey(){
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth()+1).padStart(2,"0");
  const dd = String(d.getDate()).padStart(2,"0");
  return `${yyyy}-${mm}-${dd}`;
}

// ISO week (approx but solid enough for study tracking)
function isoWeekKey(date = new Date()){
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(),0,1));
  const weekNo = Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
  const ww = String(weekNo).padStart(2,"0");
  return `${d.getUTCFullYear()}-W${ww}`;
}

function daysBetween(a,b){
  // a,b: Date
  const one = Date.UTC(a.getFullYear(),a.getMonth(),a.getDate());
  const two = Date.UTC(b.getFullYear(),b.getMonth(),b.getDate());
  return Math.round((two-one)/86400000);
}

// ---------- UI refs ----------
const $ = (s)=>document.querySelector(s);
const pages = {
  home: $("#page-home"),
  plan: $("#page-plan"),
  bank: $("#page-bank"),
  stats: $("#page-stats"),
  settings: $("#page-settings")
};
const tabs = document.querySelectorAll(".tab");

// Home stats
const streakEl = $("#streak");
const streakEl2 = $("#streak2");
const weekHoursEl = $("#weekHours");
const weekMinEl = $("#weekMin");
const daysDoneEl = $("#daysDone");
const greetingEl = $("#greeting");

const doneTodayEl = $("#doneToday");
const totalTodayEl = $("#totalToday");
const doneNoteEl = $("#doneNote");

// Tasks
const taskInput = $("#taskInput");
const btnAddTask = $("#btnAddTask");
const taskList = $("#taskList");
const btnClearDone = $("#btnClearDone");

// Plan
const planSubject = $("#planSubject");
const planTarget = $("#planTarget");
const btnAddPlan = $("#btnAddPlan");
const planList = $("#planList");

// QA
const qTitle = $("#qTitle");
const qAnswer = $("#qAnswer");
const btnAddQA = $("#btnAddQA");
const qaList = $("#qaList");
const btnShuffle = $("#btnShuffle");
const qaRandom = $("#qaRandom");
const randQ = $("#randQ");
const randA = $("#randA");
const btnShowA = $("#btnShowA");

// Manual minutes
const manualMin = $("#manualMin");
const btnAddMinutes = $("#btnAddMinutes");
const manualNote = $("#manualNote");

// Done today
const btnDoneToday = $("#btnDoneToday");

// Export/Import/Reset
const btnExport = $("#btnExport");
const btnImport = $("#btnImport");
const importFile = $("#importFile");
const btnResetAll = $("#btnResetAll");

// ---------- Navigation ----------
function go(name){
  Object.entries(pages).forEach(([k,el])=>{
    el.classList.toggle("active", k===name);
  });
  tabs.forEach(t=>t.classList.toggle("active", t.dataset.go===name));
  renderAll();
}

tabs.forEach(t=>{
  t.addEventListener("click", ()=>go(t.dataset.go));
});

// ---------- Timer (Pomodoro) ----------
const timerText = $("#timerText");
const timerBar = $("#timerBar");
const btnStart = $("#btnStart");
const btnPause = $("#btnPause");
const btnReset = $("#btnReset");
const modeLabel = $("#timerModeLabel");
const modeChips = document.querySelectorAll(".chip");

const MODES = {
  focus: 25 * 60,
  short: 5 * 60,
  long: 15 * 60
};

let timerMode = "focus";
let totalSec = MODES[timerMode];
let leftSec = totalSec;
let tHandle = null;
let running = false;

function setMode(m){
  timerMode = m;
  totalSec = MODES[m];
  leftSec = totalSec;
  running = false;
  if(tHandle){ clearInterval(tHandle); tHandle=null; }
  updateTimerUI();
  modeLabel.textContent = `وضع: ${m==="focus"?"تركيز":(m==="short"?"راحة قصيرة":"راحة طويلة")}`;
  modeChips.forEach(c=>c.classList.toggle("active", c.dataset.mode===m));
}

modeChips.forEach(c=>c.addEventListener("click", ()=>setMode(c.dataset.mode)));

function fmt(sec){
  const m = Math.floor(sec/60);
  const s = sec%60;
  return `${String(m).padStart(2,"0")}:${String(s).padStart(2,"0")}`;
}

function updateTimerUI(){
  timerText.textContent = fmt(leftSec);
  const done = (totalSec-leftSec)/totalSec;
  timerBar.style.width = `${Math.max(0, Math.min(100, done*100))}%`;
}

function tick(){
  if(!running) return;
  leftSec -= 1;
  if(leftSec <= 0){
    leftSec = 0;
    running = false;
    clearInterval(tHandle); tHandle=null;
    updateTimerUI();

    // reward: if focus session completed, add 25 minutes to week
    if(timerMode === "focus"){
      addMinutesToWeek(25);
      flashNote(manualNote, "تم إضافة 25 دقيقة للأسبوع ✅");
    }

    // small vibration if supported
    if (navigator.vibrate) navigator.vibrate([80,40,80]);
    return;
  }
  updateTimerUI();
}

btnStart.addEventListener("click", ()=>{
  if(running) return;
  running = true;
  if(!tHandle) tHandle = setInterval(tick, 1000);
});
btnPause.addEventListener("click", ()=>{
  running = false;
});
btnReset.addEventListener("click", ()=>{
  running = false;
  if(tHandle){ clearInterval(tHandle); tHandle=null; }
  leftSec = totalSec;
  updateTimerUI();
});

updateTimerUI();

// ---------- Tasks ----------
function getTodayTasks(){
  const k = todayKey();
  if(!state.tasksByDay[k]) state.tasksByDay[k] = [];
  return state.tasksByDay[k];
}

function addTask(text){
  const list = getTodayTasks();
  list.unshift({
    id: cryptoId(),
    text: text.trim(),
    done: false,
    ts: Date.now()
  });
  save();
}

function toggleTask(id){
  const list = getTodayTasks();
  const t = list.find(x=>x.id===id);
  if(!t) return;
  t.done = !t.done;
  save();
}

function removeTask(id){
  const k = todayKey();
  state.tasksByDay[k] = (state.tasksByDay[k]||[]).filter(x=>x.id!==id);
  save();
}

function clearDone(){
  const k = todayKey();
  state.tasksByDay[k] = (state.tasksByDay[k]||[]).filter(x=>!x.done);
  save();
}

btnAddTask.addEventListener("click", ()=>{
  const v = taskInput.value;
  if(!v.trim()) return;
  addTask(v);
  taskInput.value = "";
  renderAll();
});
taskInput.addEventListener("keydown", (e)=>{
  if(e.key==="Enter"){
    e.preventDefault();
    btnAddTask.click();
  }
});
btnClearDone.addEventListener("click", ()=>{
  clearDone();
  renderAll();
});

// ---------- Done Today + Streak ----------
function markDoneToday(){
  const k = todayKey();
  state.doneDays[k] = true;
  save();
}

btnDoneToday.addEventListener("click", ()=>{
  markDoneToday();
  renderAll();
});

function computeStreak(){
  // streak counts consecutive days ending today if today is done
  // If today not done, streak ends at last done day but show as that chain (optional). We'll show "ending at last done day".
  const doneKeys = Object.keys(state.doneDays||{}).filter(k=>state.doneDays[k]).sort();
  if(doneKeys.length===0) return {streak:0, last:null};

  const lastKey = doneKeys[doneKeys.length-1];
  const last = new Date(lastKey+"T00:00:00");
  let streak = 1;

  for(let i=doneKeys.length-2; i>=0; i--){
    const cur = new Date(doneKeys[i]+"T00:00:00");
    const diff = daysBetween(cur, last); // days from cur to last
    if(diff === streak) {
      streak += 1;
    } else if(diff > streak) {
      break;
    }
  }
  return {streak, last: lastKey};
}

// ---------- Week minutes ----------
function addMinutesToWeek(min){
  const wk = isoWeekKey();
  if(!state.weekLog) state.weekLog = {};
  state.weekLog[wk] = (state.weekLog[wk] || 0) + Number(min || 0);
  save();
}

btnAddMinutes.addEventListener("click", ()=>{
  const v = Number(manualMin.value);
  if(!v || v<=0) return;
  addMinutesToWeek(v);
  manualMin.value = "";
  flashNote(manualNote, `تم إضافة ${v} دقيقة ✅`);
  renderAll();
});

// ---------- Plan ----------
function addPlan(subject, targetHours){
  state.plans = state.plans || [];
  state.plans.unshift({
    id: cryptoId(),
    subject: subject.trim(),
    targetHours: Number(targetHours || 0)
  });
  save();
}

function removePlan(id){
  state.plans = (state.plans||[]).filter(x=>x.id!==id);
  save();
}

btnAddPlan.addEventListener("click", ()=>{
  const s = planSubject.value;
  const t = planTarget.value;
  if(!s.trim()) return;
  addPlan(s, t);
  planSubject.value="";
  planTarget.value="";
  renderAll();
});

// ---------- QA ----------
function addQA(q,a){
  state.qa = state.qa || [];
  state.qa.unshift({
    id: cryptoId(),
    q: q.trim(),
    a: a.trim(),
    ts: Date.now()
  });
  save();
}

function removeQA(id){
  state.qa = (state.qa||[]).filter(x=>x.id!==id);
  save();
}

btnAddQA.addEventListener("click", ()=>{
  const q = qTitle.value;
  const a = qAnswer.value;
  if(!q.trim() || !a.trim()) return;
  addQA(q,a);
  qTitle.value="";
  qAnswer.value="";
  renderAll();
});

btnShuffle.addEventListener("click", ()=>{
  const arr = state.qa || [];
  if(arr.length===0) return;
  const pick = arr[Math.floor(Math.random()*arr.length)];
  qaRandom.style.display = "block";
  randQ.textContent = "❓ " + pick.q;
  randA.textContent = "✅ " + pick.a;
  randA.style.display = "none";
});

btnShowA.addEventListener("click", ()=>{
  randA.style.display = randA.style.display==="none" ? "block" : "none";
});

// ---------- Export / Import / Reset ----------
btnExport.addEventListener("click", ()=>{
  const blob = new Blob([JSON.stringify(state,null,2)], {type:"application/json"});
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "study_anchor_backup.json";
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
});

btnImport.addEventListener("click", ()=>importFile.click());

importFile.addEventListener("change", async ()=>{
  const file = importFile.files?.[0];
  if(!file) return;
  try{
    const txt = await file.text();
    const obj = JSON.parse(txt);
    // basic validation
    if(typeof obj !== "object" || !obj) throw new Error("invalid");
    localStorage.setItem(KEY, JSON.stringify(obj));
    location.reload();
  } catch {
    alert("الملف غير صالح.");
  }
});

btnResetAll.addEventListener("click", ()=>{
  const ok = confirm("متأكد؟ سيتم مسح كل بياناتك نهائيًا.");
  if(!ok) return;
  localStorage.removeItem(KEY);
  location.reload();
});

// ---------- Rendering ----------
function renderTasks(){
  const list = getTodayTasks();
  taskList.innerHTML = "";

  let done = 0;
  list.forEach(t=>{
    if(t.done) done++;
    const el = document.createElement("div");
    el.className = "item";
    el.innerHTML = `
      <div class="item-left">
        <input class="check" type="checkbox" ${t.done?"checked":""} />
        <div>
          <div class="item-title">${escapeHtml(t.text)}</div>
          <div class="item-sub">${new Date(t.ts).toLocaleTimeString([], {hour:"2-digit", minute:"2-digit"})}</div>
        </div>
      </div>
      <div class="item-actions">
        <button class="iconbtn ghost" title="حذف">🗑️</button>
      </div>
    `;
    const chk = el.querySelector("input");
    chk.addEventListener("change", ()=>{
      toggleTask(t.id);
      renderAll();
    });
    const del = el.querySelector("button");
    del.addEventListener("click", ()=>{
      removeTask(t.id);
      renderAll();
    });

    taskList.appendChild(el);
  });

  doneTodayEl.textContent = String(done);
  totalTodayEl.textContent = String(list.length);
}

function renderPlan(){
  planList.innerHTML = "";
  const arr = state.plans || [];
  arr.forEach(p=>{
    const el = document.createElement("div");
    el.className = "item";
    el.innerHTML = `
      <div class="item-left">
        <div>
          <div class="item-title">📘 ${escapeHtml(p.subject)}</div>
          <div class="item-sub">هدف: ${Number(p.targetHours||0)} ساعة/أسبوع</div>
        </div>
      </div>
      <div class="item-actions">
        <button class="iconbtn ghost" title="حذف">🗑️</button>
      </div>
    `;
    el.querySelector("button").addEventListener("click", ()=>{
      removePlan(p.id);
      renderAll();
    });
    planList.appendChild(el);
  });

  if(arr.length===0){
    const empty = document.createElement("div");
    empty.className="hint";
    empty.textContent="لا توجد مواد بعد. أضف مادة وهدف أسبوعي.";
    planList.appendChild(empty);
  }
}

function renderQA(){
  qaList.innerHTML = "";
  const arr = state.qa || [];

  arr.forEach(x=>{
    const el = document.createElement("div");
    el.className="item";
    el.innerHTML = `
      <div class="item-left">
        <div>
          <div class="item-title">❓ ${escapeHtml(x.q)}</div>
          <div class="item-sub">اضغط لإظهار الجواب</div>
          <div class="item-sub" style="display:none; margin-top:6px; color: rgba(255,255,255,.86);">✅ ${escapeHtml(x.a)}</div>
        </div>
      </div>
      <div class="item-actions">
        <button class="iconbtn ghost" title="حذف">🗑️</button>
      </div>
    `;
    const answerLine = el.querySelectorAll(".item-sub")[1];
    el.querySelector(".item-left").addEventListener("click", ()=>{
      answerLine.style.display = answerLine.style.display==="none" ? "block" : "none";
    });
    el.querySelector("button").addEventListener("click", (e)=>{
      e.stopPropagation();
      removeQA(x.id);
      renderAll();
    });
    qaList.appendChild(el);
  });

  if(arr.length===0){
    const empty = document.createElement("div");
    empty.className="hint";
    empty.textContent="أضف أول سؤال وإجابه للمراجعة.";
    qaList.appendChild(empty);
  }
}

function renderStats(){
  const wk = isoWeekKey();
  const minutes = Number((state.weekLog && state.weekLog[wk]) || 0);
  weekMinEl.textContent = String(minutes);
  weekHoursEl.textContent = (minutes/60).toFixed(1);

  const doneCount = Object.values(state.doneDays||{}).filter(Boolean).length;
  daysDoneEl.textContent = String(doneCount);

  const {streak, last} = computeStreak();
  streakEl.textContent = String(streak);
  streakEl2.textContent = String(streak);

  const today = todayKey();
  const isDoneToday = !!(state.doneDays && state.doneDays[today]);
  doneNoteEl.textContent = isDoneToday
    ? "✅ اليوم مُثبت. كمل وخلّينا نحافظ على الستريك!"
    : (last ? `آخر يوم مُثبت: ${last}` : "لسّا ما ثبّتت ولا يوم. جرّب اليوم!");

  // Greeting
  const h = new Date().getHours();
  const part = h<12 ? "صباح الخير" : (h<18 ? "مساء الخير" : "مساء النور");
  greetingEl.textContent = `${part} — خطوة صغيرة اليوم تصنع فرق كبير.`;
}

function renderAll(){
  renderTasks();
  renderPlan();
  renderQA();
  renderStats();
}

// ---------- Utils ----------
function cryptoId(){
  if (window.crypto?.randomUUID) return crypto.randomUUID();
  return String(Date.now()) + "_" + Math.random().toString(16).slice(2);
}

function flashNote(el, msg){
  if(!el) return;
  el.textContent = msg;
  el.style.opacity = "1";
  setTimeout(()=>{ el.style.opacity="0.92"; }, 800);
  setTimeout(()=>{ el.textContent=""; el.style.opacity="1"; }, 2600);
}

function escapeHtml(str){
  return String(str)
    .replaceAll("&","&amp;")
    .replaceAll("<","&lt;")
    .replaceAll(">","&gt;")
    .replaceAll('"',"&quot;")
    .replaceAll("'","&#039;");
}

// Initial render
renderAll();
