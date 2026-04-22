const dropzone = document.getElementById("dropzone");
const fileInput = document.getElementById("fileInput");
const fileList = document.getElementById("fileList");
const actions = document.getElementById("actions");
const compressBtn = document.getElementById("compressBtn");
const clearBtn = document.getElementById("clearBtn");
const progress = document.getElementById("progress");
const progressBar = document.getElementById("progressBar");
const progressPct = document.getElementById("progressPct");
const results = document.getElementById("results");
const resultList = document.getElementById("resultList");
const downloadAllBtn = document.getElementById("downloadAllBtn");
const sumOriginal = document.getElementById("sumOriginal");
const sumCompressed = document.getElementById("sumCompressed");
const sumSaved = document.getElementById("sumSaved");

let selectedFiles = [];
let sessionId = null;

const IMAGE_EXTS = ["jpg","jpeg","png","webp","bmp","tiff","gif"];
const VIDEO_EXTS = ["mp4","mov","avi","mkv","webm","flv","wmv","m4v"];
const AUDIO_EXTS = ["mp3","wav","flac","aac","ogg","m4a","wma"];

function getExt(name) { return name.split(".").pop().toLowerCase(); }
function getType(name) {
  const e = getExt(name);
  if (IMAGE_EXTS.includes(e)) return "img";
  if (VIDEO_EXTS.includes(e)) return "vid";
  if (AUDIO_EXTS.includes(e)) return "aud";
  return "unk";
}
function pillClass(t) { return {img:"pill-img",vid:"pill-vid",aud:"pill-aud",unk:"pill-unk"}[t]; }
function pillLabel(t) { return {img:"Image",vid:"Video",aud:"Audio",unk:"Unknown"}[t]; }
function fmtSize(b) {
  if (b >= 1e9) return (b/1e9).toFixed(2) + " GB";
  if (b >= 1e6) return (b/1e6).toFixed(2) + " MB";
  if (b >= 1e3) return (b/1e3).toFixed(1) + " KB";
  return b + " B";
}
function isMobile() { return /Mobi|Android|iPhone|iPad/i.test(navigator.userAgent); }

function renderFileList() {
  fileList.innerHTML = "";
  if (!selectedFiles.length) { fileList.classList.add("hidden"); actions.classList.add("hidden"); return; }
  fileList.classList.remove("hidden");
  actions.classList.remove("hidden");
  selectedFiles.forEach((f, i) => {
    const t = getType(f.name);
    const div = document.createElement("div");
    div.className = "file-item flex items-center gap-3 bg-slate-900 border border-slate-800 rounded-xl px-4 py-3";
    div.innerHTML = `
      <span class="pill ${pillClass(t)}">${pillLabel(t)}</span>
      <span class="flex-1 text-sm font-dm text-slate-200 truncate">${f.name}</span>
      <span class="text-xs text-slate-500 font-dm shrink-0">${fmtSize(f.size)}</span>
      <button data-i="${i}" class="remove-btn text-slate-600 hover:text-red-400 text-lg leading-none transition-colors ml-1">×</button>
    `;
    fileList.appendChild(div);
  });
  fileList.querySelectorAll(".remove-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      selectedFiles.splice(Number(btn.dataset.i), 1);
      renderFileList();
    });
  });
}

function addFiles(newFiles) {
  Array.from(newFiles).forEach(f => {
    if (!selectedFiles.find(x => x.name === f.name && x.size === f.size)) selectedFiles.push(f);
  });
  renderFileList();
  results.classList.add("hidden");
}

dropzone.addEventListener("click", () => fileInput.click());
fileInput.addEventListener("change", e => addFiles(e.target.files));
dropzone.addEventListener("dragover", e => { e.preventDefault(); dropzone.classList.add("drag-over"); });
dropzone.addEventListener("dragleave", () => dropzone.classList.remove("drag-over"));
dropzone.addEventListener("drop", e => { e.preventDefault(); dropzone.classList.remove("drag-over"); addFiles(e.dataTransfer.files); });
clearBtn.addEventListener("click", () => { selectedFiles = []; fileInput.value = ""; renderFileList(); results.classList.add("hidden"); });

function setProgress(pct) {
  progressBar.style.width = pct + "%";
  progressPct.textContent = pct + "%";
}

compressBtn.addEventListener("click", async () => {
  if (!selectedFiles.length) return;
  compressBtn.disabled = true;
  compressBtn.textContent = "Compressing…";
  progress.classList.remove("hidden");
  results.classList.add("hidden");
  setProgress(10);
  const fd = new FormData();
  selectedFiles.forEach(f => fd.append("files", f));
  let resp;
  try {
    const xhr = new XMLHttpRequest();
    const data = await new Promise((res, rej) => {
      xhr.open("POST", "/compress");
      xhr.upload.onprogress = e => { if (e.lengthComputable) setProgress(Math.round(10 + (e.loaded/e.total)*60)); };
      xhr.onload = () => res(JSON.parse(xhr.responseText));
      xhr.onerror = rej;
      xhr.send(fd);
    });
    setProgress(90);
    sessionId = data.session_id;
    renderResults(data.results);
    setProgress(100);
    setTimeout(() => { progress.classList.add("hidden"); setProgress(0); }, 600);
  } catch(e) {
    alert("Compression failed. Is the server running?");
    progress.classList.add("hidden");
  }
  compressBtn.disabled = false;
  compressBtn.textContent = "Compress Files";
});

function renderResults(res) {
  resultList.innerHTML = "";
  let totalOrig = 0, totalComp = 0;
  res.forEach(r => {
    totalOrig += r.original_size || 0;
    if (r.status === "ok") totalComp += r.compressed_size || 0;
    const saved = r.original_size && r.compressed_size ? Math.round((1 - r.compressed_size/r.original_size)*100) : 0;
    const ok = r.status === "ok";
    const t = getType(r.original || r.name);
    const div = document.createElement("div");
    div.className = "result-item flex items-center gap-3 bg-slate-900 border border-slate-800 rounded-xl px-4 py-3";
    div.innerHTML = ok ? `
      <span class="pill ${pillClass(t)}">${pillLabel(t)}</span>
      <span class="flex-1 text-sm font-dm text-slate-200 truncate">${r.name}</span>
      <span class="text-xs text-slate-500 font-dm shrink-0">${fmtSize(r.original_size)} → ${fmtSize(r.compressed_size)}</span>
      <span class="text-xs font-syne font-bold text-emerald-400 shrink-0">−${saved}%</span>
      <a href="/download/${sessionId}/${encodeURIComponent(r.name)}" download="${r.name}" class="shrink-0 bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-syne font-semibold px-3 py-1.5 rounded-lg transition-all">↓</a>
    ` : `
      <span class="pill ${pillClass(t)}">${pillLabel(t)}</span>
      <span class="flex-1 text-sm font-dm text-slate-400 truncate">${r.original || r.name}</span>
      <span class="text-xs text-red-400 font-dm">${r.status === "unsupported" ? "Unsupported" : "Error"}</span>
    `;
    resultList.appendChild(div);
  });
  sumOriginal.textContent = fmtSize(totalOrig);
  sumCompressed.textContent = totalComp ? fmtSize(totalComp) : "—";
  const pct = totalOrig && totalComp ? Math.round((1 - totalComp/totalOrig)*100) : 0;
  sumSaved.textContent = totalComp ? `${fmtSize(totalOrig - totalComp)} (${pct}%)` : "—";
  downloadAllBtn.onclick = () => { window.location.href = `/download-all/${sessionId}`; };
  if (isMobile()) document.getElementById("mobileDeleteHint").classList.remove("hidden");
  results.classList.remove("hidden");
}