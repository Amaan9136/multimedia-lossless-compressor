const dropzone = document.getElementById("dropzone");
const fileInput = document.getElementById("fileInput");
const fileList = document.getElementById("fileList");
const actions = document.getElementById("actions");
const compressBtn = document.getElementById("compressBtn");
const clearBtn = document.getElementById("clearBtn");
const progress = document.getElementById("progress");
const progressBar = document.getElementById("progressBar");
const progressPct = document.getElementById("progressPct");
const progressLog = document.getElementById("progressLog");
const results = document.getElementById("results");
const resultList = document.getElementById("resultList");
const downloadAllBtn = document.getElementById("downloadAllBtn");
const cleanupBtn = document.getElementById("cleanupBtn");
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
    btn.addEventListener("click", () => { selectedFiles.splice(Number(btn.dataset.i), 1); renderFileList(); });
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

function addLog(msg, cls = "text-slate-400") {
  const line = document.createElement("div");
  line.className = `font-dm text-xs ${cls}`;
  line.textContent = msg;
  progressLog.appendChild(line);
  progressLog.scrollTop = progressLog.scrollHeight;
  return line;
}

function clearLog() { progressLog.innerHTML = ""; }

compressBtn.addEventListener("click", async () => {
  if (!selectedFiles.length) return;
  compressBtn.disabled = true;
  compressBtn.textContent = "Compressing…";
  progress.classList.remove("hidden");
  results.classList.add("hidden");
  clearLog();
  setProgress(0);

  const totalSize = selectedFiles.reduce((s, f) => s + f.size, 0);
  const fd = new FormData();
  selectedFiles.forEach(f => fd.append("files", f));

  addLog(`📦 ${selectedFiles.length} file${selectedFiles.length > 1 ? "s" : ""} — ${fmtSize(totalSize)} total`);
  const uploadLine = addLog(`⬆ Uploading to local network…`);
  const uploadStart = Date.now();

  try {
    const resp = await new Promise((res, rej) => {
      const xhr = new XMLHttpRequest();
      xhr.open("POST", "/compress");
      xhr.responseType = "text";
      xhr.upload.onprogress = e => {
        if (!e.lengthComputable) return;
        const pct = Math.round((e.loaded / e.total) * 40);
        setProgress(pct);
        const elapsed = (Date.now() - uploadStart) / 1000 || 0.001;
        const rate = e.loaded / elapsed;
        const remaining = rate > 0 ? (e.total - e.loaded) / rate : 0;
        const eta = remaining > 60 ? `${Math.ceil(remaining/60)}m ${Math.round(remaining%60)}s` : `${Math.ceil(remaining)}s`;
        uploadLine.textContent = `⬆ Uploading… ${fmtSize(e.loaded)} / ${fmtSize(e.total)}  ${fmtSize(rate)}/s  ETA ${eta}`;
      };
      xhr.onload = () => {
        const elapsed = ((Date.now() - uploadStart) / 1000).toFixed(1);
        const rate = fmtSize(totalSize / (parseFloat(elapsed) || 1));
        uploadLine.textContent = `✓ Upload done — ${fmtSize(totalSize)} in ${elapsed}s  (${rate}/s)`;
        res(xhr.responseText);
      };
      xhr.onerror = rej;
      xhr.send(fd);
    });

    setProgress(45);

    const lines = resp.trim().split("\n").filter(Boolean);
    let allResults = [];
    let totalOriginalSize = 0;
    let totalCompressedSize = 0;
    let totalFiles = 0;

    for (const line of lines) {
      let msg;
      try { msg = JSON.parse(line); } catch { continue; }

      if (msg.type === "start") {
        totalOriginalSize = msg.total_original_size;
        totalFiles = msg.total_files;
        addLog(`⚙ Compressing ${totalFiles} file${totalFiles > 1 ? "s" : ""}  —  ${fmtSize(totalOriginalSize)} total`, "text-slate-400");
      } else if (msg.type === "progress") {
        const pct = 45 + Math.round(((msg.index) / totalFiles) * 50);
        setProgress(pct);
        addLog(`  ⟳ [${msg.index + 1}/${totalFiles}] ${msg.file}  ${fmtSize(msg.original_size)}`, "text-slate-500");
      } else if (msg.type === "file_done") {
        const r = msg.result;
        totalCompressedSize = msg.total_compressed_size;
        if (r.status === "ok") {
          const saved = r.original_size && r.compressed_size ? Math.round((1 - r.compressed_size / r.original_size) * 100) : 0;
          addLog(`  ✓ ${r.name}  ${fmtSize(r.original_size)} → ${fmtSize(r.compressed_size)}  (−${saved}%)`, "text-emerald-400");
        } else if (r.status === "unsupported") {
          addLog(`  ✗ ${r.original || r.name}  unsupported format`, "text-amber-500");
        } else {
          addLog(`  ✗ ${r.original || r.name}  error: ${r.error || "unknown"}`, "text-red-400");
        }
      } else if (msg.type === "done") {
        allResults = msg.results;
        sessionId = msg.session_id;
        totalOriginalSize = msg.total_original_size;
        totalCompressedSize = msg.total_compressed_size;
        const saved = totalOriginalSize - totalCompressedSize;
        const pct = totalOriginalSize > 0 && totalCompressedSize > 0 ? Math.round((saved / totalOriginalSize) * 100) : 0;
        const okCount = allResults.filter(r => r.status === "ok").length;
        if (okCount > 0) addLog(`📊 ${fmtSize(totalOriginalSize)} → ${fmtSize(totalCompressedSize)}  saved ${fmtSize(saved)} (${pct}%)  across ${okCount} file${okCount > 1 ? "s" : ""}`, "text-violet-400");
      }
    }

    renderResults(allResults);
    setProgress(100);
    setTimeout(() => { progress.classList.add("hidden"); setProgress(0); }, 800);
  } catch(e) {
    addLog("✗ Compression failed. Is the server running?", "text-red-400");
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
  cleanupBtn.onclick = async () => {
    if (!confirm("Delete all compressed files from the server? This cannot be undone.")) return;
    try {
      const r = await fetch(`/cleanup/${sessionId}`, { method: "DELETE" });
      const d = await r.json();
      if (d.ok) {
        cleanupBtn.textContent = "✓ Removed";
        cleanupBtn.disabled = true;
        cleanupBtn.className = "border border-slate-700 text-slate-600 font-syne font-semibold text-xs px-4 py-2 rounded-lg cursor-not-allowed";
        downloadAllBtn.disabled = true;
        downloadAllBtn.className = "bg-slate-800 text-slate-600 font-syne font-semibold text-xs px-4 py-2 rounded-lg cursor-not-allowed";
        resultList.querySelectorAll("a").forEach(a => { a.removeAttribute("href"); a.className = a.className + " opacity-30 pointer-events-none"; });
      }
    } catch(e) { alert("Failed to remove files from server."); }
  };
  if (isMobile()) document.getElementById("mobileDeleteHint").classList.remove("hidden");
  results.classList.remove("hidden");
}