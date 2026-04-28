const CHUNK_SIZE   = 2 * 1024 * 1024;
const MAX_PARALLEL = 4;
const IMAGE_EXTS = ["jpg","jpeg","png","webp","bmp","tiff","gif"];
const VIDEO_EXTS = ["mp4","mov","avi","mkv","webm","flv","wmv","m4v"];
const AUDIO_EXTS = ["mp3","wav","flac","aac","ogg","m4a","wma"];
const dropzone       = document.getElementById("dropzone");
const fileInput      = document.getElementById("fileInput");
const fileList       = document.getElementById("fileList");
const actions        = document.getElementById("actions");
const compressBtn    = document.getElementById("compressBtn");
const clearBtn       = document.getElementById("clearBtn");
const progress       = document.getElementById("progress");
const progressBar    = document.getElementById("progressBar");
const progressPct    = document.getElementById("progressPct");
const progressLabel  = document.getElementById("progressLabel");
const progressLog    = document.getElementById("progressLog");
const results        = document.getElementById("results");
const resultList     = document.getElementById("resultList");
const downloadAllBtn = document.getElementById("downloadAllBtn");
const cleanupBtn     = document.getElementById("cleanupBtn");
const sumOriginal    = document.getElementById("sumOriginal");
const sumCompressed  = document.getElementById("sumCompressed");
const sumSaved       = document.getElementById("sumSaved");
let selectedFiles = [];
let sessionId     = null;
function getExt(name)  { return name.split(".").pop().toLowerCase(); }
function getType(name) {
  const e = getExt(name);
  if (IMAGE_EXTS.includes(e)) return "img";
  if (VIDEO_EXTS.includes(e)) return "vid";
  if (AUDIO_EXTS.includes(e)) return "aud";
  return "unk";
}
const PILL_CLS   = {img:"pill-img", vid:"pill-vid", aud:"pill-aud", unk:"pill-unk"};
const PILL_LABEL = {img:"Image",    vid:"Video",    aud:"Audio",    unk:"Unknown"};
function fmtSize(b) {
  if (b >= 1e9) return (b/1e9).toFixed(2) + " GB";
  if (b >= 1e6) return (b/1e6).toFixed(2) + " MB";
  if (b >= 1e3) return (b/1e3).toFixed(1) + " KB";
  return b + " B";
}
function isMobile() { return /Mobi|Android|iPhone|iPad/i.test(navigator.userAgent); }
function uid()      { return crypto.randomUUID(); }
function ts()       { return new Date().toISOString().slice(11, 23); }
function renderFileList() {
  fileList.innerHTML = "";
  if (!selectedFiles.length) {
    fileList.classList.add("hidden");
    actions.classList.add("hidden");
    return;
  }
  fileList.classList.remove("hidden");
  actions.classList.remove("hidden");
  selectedFiles.forEach((f, i) => {
    const t   = getType(f.name);
    const div = document.createElement("div");
    div.className = "file-item flex items-center gap-3 bg-slate-900 border border-slate-800 rounded-xl px-4 py-3";
    div.innerHTML = `
      <span class="pill ${PILL_CLS[t]}">${PILL_LABEL[t]}</span>
      <span class="flex-1 text-sm font-dm text-slate-200 truncate">${f.name}</span>
      <span class="text-xs text-slate-500 font-dm shrink-0">${fmtSize(f.size)}</span>
      <button data-i="${i}" class="remove-btn text-slate-600 hover:text-red-400 text-lg leading-none transition-colors ml-1">×</button>
    `;
    fileList.appendChild(div);
  });
  fileList.querySelectorAll(".remove-btn").forEach(btn =>
    btn.addEventListener("click", () => { selectedFiles.splice(+btn.dataset.i, 1); renderFileList(); })
  );
}
function addFiles(newFiles) {
  Array.from(newFiles).forEach(f => {
    if (!selectedFiles.find(x => x.name === f.name && x.size === f.size)) selectedFiles.push(f);
  });
  renderFileList();
  results.classList.add("hidden");
}
dropzone.addEventListener("click",    () => fileInput.click());
fileInput.addEventListener("change",  e  => addFiles(e.target.files));
dropzone.addEventListener("dragover", e  => { e.preventDefault(); dropzone.classList.add("drag-over"); });
dropzone.addEventListener("dragleave",()  => dropzone.classList.remove("drag-over"));
dropzone.addEventListener("drop", e => {
  e.preventDefault();
  dropzone.classList.remove("drag-over");
  addFiles(e.dataTransfer.files);
});
clearBtn.addEventListener("click", () => {
  selectedFiles = [];
  fileInput.value = "";
  renderFileList();
  results.classList.add("hidden");
});
function setProgress(pct, label) {
  progressBar.style.width = pct + "%";
  progressPct.textContent = Math.round(pct) + "%";
  if (label) progressLabel.textContent = label;
}
const LOG_COLOR = {info:"text-slate-300", ok:"text-emerald-400", warn:"text-amber-400", error:"text-red-400", debug:"text-slate-500"};
function addLog(msg, level = "info") {
  const line = document.createElement("div");
  line.className = `font-mono text-xs ${LOG_COLOR[level] || "text-slate-400"} whitespace-pre-wrap break-all`;
  line.textContent = `[${ts()}] ${msg}`;
  progressLog.appendChild(line);
  requestAnimationFrame(() => { progressLog.scrollTop = progressLog.scrollHeight; });
  return line;
}
function clearLog() { progressLog.innerHTML = ""; }
async function uploadFile(file, onProgress) {
  const fileId        = uid();
  const totalChunks   = Math.ceil(file.size / CHUNK_SIZE) || 1;
  const bytesPerChunk = new Array(totalChunks).fill(0);
  const chunks = Array.from({length: totalChunks}, (_, i) => ({
    index: i,
    blob:  file.slice(i * CHUNK_SIZE, Math.min((i + 1) * CHUNK_SIZE, file.size)),
  }));
  async function uploadChunk(chunk) {
    const resp = await fetch("/upload-chunk", {
      method: "POST",
      headers: {
        "X-File-Id":      fileId,
        "X-Chunk-Index":  String(chunk.index),
        "X-Total-Chunks": String(totalChunks),
        "X-File-Name":    encodeURIComponent(file.name),
        "Content-Type":   "application/octet-stream",
      },
      body: chunk.blob,
    });
    if (!resp.ok) throw new Error(`Chunk ${chunk.index} failed: ${resp.status}`);
    bytesPerChunk[chunk.index] = chunk.blob.size;
    onProgress(bytesPerChunk.reduce((a, b) => a + b, 0), file.size);
  }
  const queue = [...chunks];
  async function worker() {
    while (queue.length) {
      const chunk = queue.shift();
      if (chunk) await uploadChunk(chunk);
    }
  }
  await Promise.all(Array.from({length: Math.min(MAX_PARALLEL, totalChunks)}, worker));
  return {fileId, name: file.name};
}
compressBtn.addEventListener("click", async () => {
  if (!selectedFiles.length) return;
  compressBtn.disabled    = true;
  compressBtn.textContent = "Uploading…";
  progress.classList.remove("hidden");
  results.classList.add("hidden");
  clearLog();
  setProgress(0, "Uploading…");
  const totalSize    = selectedFiles.reduce((s, f) => s + f.size, 0);
  const sessionToken = uid();
  const fileManifest = [];
  addLog(`📦 ${selectedFiles.length} file${selectedFiles.length > 1 ? "s" : ""} — ${fmtSize(totalSize)} total`);
  let globalLoaded  = 0;
  const uploadStart = Date.now();
  const uploadLine  = addLog("⬆  Starting upload…");
  try {
    for (let fi = 0; fi < selectedFiles.length; fi++) {
      const file = selectedFiles[fi];
      addLog(`  → [${fi+1}/${selectedFiles.length}] ${file.name}  (${fmtSize(file.size)})`);
      let filePrev = 0;
      const {fileId, name} = await uploadFile(file, (loaded) => {
        const delta   = loaded - filePrev;
        filePrev      = loaded;
        globalLoaded += delta;
        setProgress((globalLoaded / totalSize) * 40, "Uploading…");
        const elapsed = (Date.now() - uploadStart) / 1000 || 0.001;
        const rate    = globalLoaded / elapsed;
        const rem     = rate > 0 ? (totalSize - globalLoaded) / rate : 0;
        const eta     = rem > 60 ? `${Math.ceil(rem/60)}m ${Math.round(rem%60)}s` : `${Math.ceil(rem)}s`;
        uploadLine.textContent = `[${ts()}] ⬆  Uploading ${fmtSize(globalLoaded)} / ${fmtSize(totalSize)}  ${fmtSize(rate)}/s  ETA ${eta}`;
      });
      fileManifest.push({file_id: fileId, name});
      addLog(`  ✓ [${fi+1}/${selectedFiles.length}] ${name} uploaded`, "ok");
    }
    const elapsed = ((Date.now() - uploadStart) / 1000).toFixed(1);
    uploadLine.textContent = `[${ts()}] ✓ Upload done — ${fmtSize(totalSize)} in ${elapsed}s  (${fmtSize(totalSize / (parseFloat(elapsed) || 1))}/s)`;
    setProgress(40, "Compressing…");
    compressBtn.textContent = "Compressing…";
    addLog("🗜  Starting compression…");
    const compResp = await fetch("/compress", {
      method:  "POST",
      headers: {"Content-Type": "application/json"},
      body:    JSON.stringify({session_id: sessionToken, files: fileManifest}),
    });
    if (!compResp.ok) throw new Error(`Compress request failed: ${compResp.status}`);
    const reader  = compResp.body.getReader();
    const decoder = new TextDecoder();
    let   buf        = "";
    let   allResults = [];
    let   totalFiles = 1;
    while (true) {
      const {done, value} = await reader.read();
      if (done) {
        if (buf.trim()) {
          try {
            const msg = JSON.parse(buf.trim());
            if (msg.type === "log") addLog(msg.msg, msg.level || "info");
            else if (msg.type === "start") { totalFiles = msg.total_files; sessionId = msg.session_id; }
            else if (msg.type === "progress") setProgress(40 + (msg.index / totalFiles) * 55, "Compressing…");
            else if (msg.type === "done") { allResults = msg.results; sessionId = msg.session_id; }
          } catch {}
        }
        break;
      }
      buf += decoder.decode(value, {stream: true});
      const lines = buf.split("\n");
      buf = lines.pop();
      for (const line of lines) {
        if (!line.trim()) continue;
        let msg;
        try { msg = JSON.parse(line); } catch { addLog(`[raw] ${line}`, "debug"); continue; }
        if (msg.type === "log") { addLog(msg.msg, msg.level || "info"); continue; }
        if (msg.type === "start") {
          totalFiles = msg.total_files;
          sessionId  = msg.session_id;
        } else if (msg.type === "progress") {
          setProgress(40 + (msg.index / totalFiles) * 55, "Compressing…");
        } else if (msg.type === "file_done") {
          allResults.push(msg.result);
        } else if (msg.type === "done") {
          allResults = msg.results;
          sessionId  = msg.session_id;
        }
      }
    }
    renderResults(allResults);
    setProgress(100, "Done ✓");
  } catch (err) {
    addLog(`✗ Failed: ${err.message}`, "error");
  }
  compressBtn.disabled    = false;
  compressBtn.textContent = "Compress Files";
});
function renderResults(res) {
  resultList.innerHTML = "";
  let totalOrig = 0, totalComp = 0;
  res.forEach(r => {
    totalOrig += r.original_size || 0;
    if (r.status === "ok") totalComp += r.compressed_size || 0;
    const saved = r.original_size && r.compressed_size ? Math.round((1 - r.compressed_size/r.original_size)*100) : 0;
    const ok  = r.status === "ok";
    const t   = getType(r.original || r.name);
    const div = document.createElement("div");
    div.className = "result-item flex items-center gap-3 bg-slate-900 border border-slate-800 rounded-xl px-4 py-3";
    div.innerHTML = ok
      ? `<span class="pill ${PILL_CLS[t]}">${PILL_LABEL[t]}</span>
         <span class="flex-1 text-sm font-dm text-slate-200 truncate">${r.name}</span>
         <span class="text-xs text-slate-500 font-dm shrink-0">${fmtSize(r.original_size)} → ${fmtSize(r.compressed_size)}</span>
         <span class="text-xs font-syne font-bold text-emerald-400 shrink-0">−${saved}%</span>
         <a href="/download/${sessionId}/${encodeURIComponent(r.name)}" download="${r.name}"
            class="shrink-0 bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-syne font-semibold px-3 py-1.5 rounded-lg transition-all">↓</a>`
      : `<span class="pill ${PILL_CLS[t]}">${PILL_LABEL[t]}</span>
         <span class="flex-1 text-sm font-dm text-slate-400 truncate">${r.original || r.name}</span>
         <span class="text-xs text-red-400 font-dm">${r.status === "unsupported" ? "Unsupported" : "Error"}</span>`;
    resultList.appendChild(div);
  });
  sumOriginal.textContent   = fmtSize(totalOrig);
  sumCompressed.textContent = totalComp ? fmtSize(totalComp) : "—";
  const pct = totalOrig && totalComp ? Math.round((1 - totalComp/totalOrig)*100) : 0;
  sumSaved.textContent      = totalComp ? `${fmtSize(totalOrig - totalComp)} (${pct}%)` : "—";
  downloadAllBtn.onclick    = () => { window.location.href = `/download-all/${sessionId}`; };
  cleanupBtn.onclick = async () => {
    if (!confirm("Delete all compressed files from the server? This cannot be undone.")) return;
    try {
      const d = await (await fetch(`/cleanup/${sessionId}`, {method: "DELETE"})).json();
      if (d.ok) {
        cleanupBtn.textContent   = "✓ Removed";
        cleanupBtn.disabled      = true;
        cleanupBtn.className     = "border border-slate-700 text-slate-600 font-syne font-semibold text-xs px-4 py-2 rounded-lg cursor-not-allowed";
        downloadAllBtn.disabled  = true;
        downloadAllBtn.className = "bg-slate-800 text-slate-600 font-syne font-semibold text-xs px-4 py-2 rounded-lg cursor-not-allowed";
        resultList.querySelectorAll("a").forEach(a => { a.removeAttribute("href"); a.className += " opacity-30 pointer-events-none"; });
      }
    } catch { alert("Failed to remove files from server."); }
  };
  if (isMobile()) document.getElementById("mobileDeleteHint").classList.remove("hidden");
  results.classList.remove("hidden");
}