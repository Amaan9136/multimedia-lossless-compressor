import os, shutil, socket, json, uuid, mimetypes, subprocess, zipfile, threading, queue, time
from urllib.parse import unquote
from flask import Flask, request, render_template, Response, stream_with_context
from flask_cors import CORS
from PIL import Image
from werkzeug.serving import WSGIRequestHandler
WSGIRequestHandler.protocol_version = "HTTP/1.1"
app = Flask(__name__)
CORS(app, origins="*")
app.config["UPLOAD_FOLDER"]             = "uploads"
app.config["COMPRESSED_FOLDER"]         = "compressed"
app.config["MAX_CONTENT_LENGTH"]        = None
app.config["MAX_FORM_MEMORY_SIZE"]      = None
app.config["SEND_FILE_MAX_AGE_DEFAULT"] = 0
os.makedirs(app.config["UPLOAD_FOLDER"],     exist_ok=True)
os.makedirs(app.config["COMPRESSED_FOLDER"], exist_ok=True)
def get_local_ip():
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        s.connect(("8.8.8.8", 80))
        return s.getsockname()[0]
    except:
        return "127.0.0.1"
    finally:
        s.close()
def emit(obj): return json.dumps(obj, separators=(",", ":")) + "\n"
def fmt_size(b):
    if b >= 1_000_000_000: return f"{b/1e9:.2f} GB"
    if b >= 1_000_000:     return f"{b/1e6:.2f} MB"
    if b >= 1_000:         return f"{b/1e3:.1f} KB"
    return f"{b} B"
IMAGE_EXTS = {"jpg", "jpeg", "png", "webp", "bmp", "tiff", "gif"}
VIDEO_EXTS = {"mp4", "mov", "avi", "mkv", "webm", "flv", "wmv", "m4v"}
AUDIO_EXTS = {"mp3", "wav", "flac", "aac", "ogg", "m4a", "wma"}
def compress_image(input_path, output_path, filename):
    ext = filename.rsplit(".", 1)[-1].lower()
    img = Image.open(input_path)
    if img.mode in ("RGBA", "P") and ext != "png":
        img = img.convert("RGB")
    if ext in ("jpg", "jpeg"):
        img.save(output_path, "JPEG", quality=72, optimize=True, progressive=True)
    elif ext == "png":
        img.save(output_path, "PNG", optimize=True, compress_level=9)
    elif ext == "webp":
        img.save(output_path, "WEBP", quality=72, method=6)
    else:
        img.save(output_path, "JPEG", quality=72, optimize=True, progressive=True)
def run_ffmpeg(cmd, label, q):
    proc = subprocess.Popen(
        cmd,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.PIPE,
        bufsize=1,
        text=True,
    )
    q.put(emit({"type": "log", "level": "info", "msg": f"▶ ffmpeg: {label}"}))
    for line in proc.stderr:
        line = line.rstrip()
        if line.strip():
            level = "debug" if line.startswith("frame=") else "info"
            q.put(emit({"type": "log", "level": level, "msg": f"  {line}"}))
    proc.wait()
    q.put(emit({"type": "log", "level": "ok" if proc.returncode == 0 else "error", "msg": f"  ffmpeg exit={proc.returncode}"}))
    q.put(("__done__", proc.returncode == 0))
def run_ffmpeg_streaming(cmd, label):
    q = queue.Queue()
    t = threading.Thread(target=run_ffmpeg, args=(cmd, label, q), daemon=True)
    t.start()
    ok = False
    while True:
        item = q.get()
        if isinstance(item, tuple) and item[0] == "__done__":
            ok = item[1]
            break
        yield item
    t.join(timeout=5)
    yield emit({"type": "_ffmpeg_done", "ok": ok})
def stem(filename):
    return filename.rsplit(".", 1)[0] if "." in filename else filename
def read_stream(path, chunk_size=1 << 17):
    with open(path, "rb") as f:
        while True:
            chunk = f.read(chunk_size)
            if not chunk:
                break
            yield chunk
@app.after_request
def add_headers(response):
    response.headers["Cache-Control"] = "no-store, no-cache, must-revalidate, max-age=0"
    response.headers["Pragma"]        = "no-cache"
    response.headers["Expires"]       = "0"
    return response
@app.route("/upload-chunk", methods=["POST"])
def upload_chunk():
    file_id      = request.headers.get("X-File-Id")
    chunk_index  = int(request.headers.get("X-Chunk-Index", 0))
    total_chunks = int(request.headers.get("X-Total-Chunks", 1))
    filename     = unquote(request.headers.get("X-File-Name", "file"))
    tmp_dir      = os.path.join(app.config["UPLOAD_FOLDER"], f"chunks_{file_id}")
    os.makedirs(tmp_dir, exist_ok=True)
    chunk_path = os.path.join(tmp_dir, f"{chunk_index:05d}")
    with open(chunk_path, "wb") as fh:
        fh.write(request.get_data(cache=False))
    chunks_present = len([f for f in os.listdir(tmp_dir) if not f.startswith(".")])
    if chunks_present < total_chunks:
        return {"ok": True, "chunk": chunk_index, "received": chunks_present, "total": total_chunks}
    final_path = os.path.join(app.config["UPLOAD_FOLDER"], f"{file_id}_{filename}")
    with open(final_path, "wb") as out:
        for i in range(total_chunks):
            with open(os.path.join(tmp_dir, f"{i:05d}"), "rb") as ch:
                shutil.copyfileobj(ch, out)
    shutil.rmtree(tmp_dir, ignore_errors=True)
    return {"ok": True, "complete": True, "path": final_path, "file_id": file_id}
@app.route("/compress", methods=["POST"])
def compress():
    body         = request.get_json(force=True, silent=True) or {}
    session_id   = body.get("session_id") or str(uuid.uuid4())
    file_entries = body.get("files", [])
    session_dir  = os.path.join(app.config["COMPRESSED_FOLDER"], session_id)
    os.makedirs(session_dir, exist_ok=True)
    def generate():
        results               = []
        total_compressed_size = 0
        saved_files           = []
        for entry in file_entries:
            name = entry["name"]
            path = os.path.join(app.config["UPLOAD_FOLDER"], f"{entry['file_id']}_{name}")
            if os.path.exists(path):
                saved_files.append((name, path))
            else:
                yield emit({"type": "log", "level": "warn", "msg": f"⚠ Missing upload for {name} (expected={path})"})
        total_original_size = sum(os.path.getsize(p) for _, p in saved_files)
        yield emit({"type": "start", "session_id": session_id, "total_files": len(saved_files), "total_original_size": total_original_size})
        yield emit({"type": "log", "level": "info", "msg": f"📦 {len(saved_files)} files — {fmt_size(total_original_size)} total"})
        for idx, (filename, input_path) in enumerate(saved_files):
            ext           = filename.rsplit(".", 1)[-1].lower() if "." in filename else ""
            original_size = os.path.getsize(input_path)
            yield emit({"type": "progress", "file": filename, "index": idx, "total": len(saved_files), "original_size": original_size})
            yield emit({"type": "log", "level": "info", "msg": f"⟳ [{idx+1}/{len(saved_files)}] {filename}  ({fmt_size(original_size)})"})
            r = None
            try:
                if ext in IMAGE_EXTS:
                    out_ext  = ext if ext in ("jpg", "jpeg", "png", "webp") else "jpg"
                    out_name = stem(filename) + "." + out_ext
                    out_path = os.path.join(session_dir, out_name)
                    yield emit({"type": "log", "level": "info", "msg": f"  🖼 Compressing image → {out_ext.upper()} quality=72"})
                    compress_image(input_path, out_path, filename)
                    compressed_size        = os.path.getsize(out_path)
                    total_compressed_size += compressed_size
                    r = {"name": out_name, "original": filename, "original_size": original_size, "compressed_size": compressed_size, "status": "ok"}
                elif ext in VIDEO_EXTS:
                    out_name = stem(filename) + ".mp4"
                    out_path = os.path.join(session_dir, out_name)
                    cmd = [
                        "ffmpeg", "-y", "-i", input_path,
                        "-vcodec", "libx264", "-crf", "28", "-preset", "fast",
                        "-acodec", "aac", "-b:a", "128k",
                        "-movflags", "+faststart",
                        out_path,
                    ]
                    yield emit({"type": "log", "level": "info", "msg": "  🎬 Encoding video → H.264 CRF28 AAC128k +faststart"})
                    ok = False
                    for chunk in run_ffmpeg_streaming(cmd, filename):
                        obj = json.loads(chunk.strip())
                        if obj.get("type") == "_ffmpeg_done":
                            ok = obj["ok"]
                        else:
                            yield chunk
                    ok = ok and os.path.exists(out_path) and os.path.getsize(out_path) > 0
                    if ok:
                        compressed_size        = os.path.getsize(out_path)
                        total_compressed_size += compressed_size
                        r = {"name": out_name, "original": filename, "original_size": original_size, "compressed_size": compressed_size, "status": "ok"}
                    else:
                        r = {"name": filename, "original": filename, "original_size": original_size, "compressed_size": 0, "status": "error", "error": "ffmpeg failed"}
                elif ext in AUDIO_EXTS:
                    out_name = stem(filename) + ".mp3"
                    out_path = os.path.join(session_dir, out_name)
                    cmd = ["ffmpeg", "-y", "-i", input_path, "-b:a", "128k", out_path]
                    yield emit({"type": "log", "level": "info", "msg": "  🔊 Encoding audio → MP3 128k"})
                    ok = False
                    for chunk in run_ffmpeg_streaming(cmd, filename):
                        obj = json.loads(chunk.strip())
                        if obj.get("type") == "_ffmpeg_done":
                            ok = obj["ok"]
                        else:
                            yield chunk
                    ok = ok and os.path.exists(out_path) and os.path.getsize(out_path) > 0
                    if ok:
                        compressed_size        = os.path.getsize(out_path)
                        total_compressed_size += compressed_size
                        r = {"name": out_name, "original": filename, "original_size": original_size, "compressed_size": compressed_size, "status": "ok"}
                    else:
                        r = {"name": filename, "original": filename, "original_size": original_size, "compressed_size": 0, "status": "error", "error": "ffmpeg failed"}
                else:
                    yield emit({"type": "log", "level": "warn", "msg": f"  ⚠ {filename} — unsupported format, skipping"})
                    r = {"name": filename, "original": filename, "original_size": original_size, "compressed_size": 0, "status": "unsupported"}
            except Exception as e:
                yield emit({"type": "log", "level": "error", "msg": f"  ✗ {filename} — {e}"})
                r = {"name": filename, "original": filename, "original_size": original_size, "compressed_size": 0, "status": "error", "error": str(e)}
            results.append(r)
            if r["status"] == "ok":
                saved = round((1 - r["compressed_size"] / r["original_size"]) * 100) if r["original_size"] else 0
                yield emit({"type": "log", "level": "ok", "msg": f"  ✓ {r['name']}  {fmt_size(r['original_size'])} → {fmt_size(r['compressed_size'])}  (−{saved}%)"})
            yield emit({"type": "file_done", "result": r, "total_compressed_size": total_compressed_size})
            try:
                os.remove(input_path)
            except OSError:
                pass
        total_saved = total_original_size - total_compressed_size
        pct = round((total_saved / total_original_size) * 100) if total_original_size else 0
        yield emit({"type": "log", "level": "ok", "msg": f"📊 Done — {fmt_size(total_original_size)} → {fmt_size(total_compressed_size)}  saved {fmt_size(total_saved)} ({pct}%)"})
        yield emit({"type": "done", "session_id": session_id, "results": results, "total_original_size": total_original_size, "total_compressed_size": total_compressed_size})
    return Response(
        stream_with_context(generate()),
        mimetype="application/x-ndjson",
        headers={"X-Accel-Buffering": "no", "Cache-Control": "no-cache"},
    )
@app.route("/download/<session_id>/<filename>")
def download_file(session_id, filename):
    path = os.path.join(app.config["COMPRESSED_FOLDER"], session_id, filename)
    if not os.path.exists(path):
        return {"error": "File not found"}, 404
    mime      = mimetypes.guess_type(path)[0] or "application/octet-stream"
    file_size = os.path.getsize(path)
    rng       = request.headers.get("Range")
    if rng:
        parts  = rng.replace("bytes=", "").split("-")
        start  = int(parts[0]) if parts[0] else 0
        end    = min(int(parts[1]) if len(parts) > 1 and parts[1] else file_size - 1, file_size - 1)
        length = end - start + 1
        def gen_range():
            with open(path, "rb") as f:
                f.seek(start)
                remaining = length
                while remaining > 0:
                    chunk = f.read(min(131072, remaining))
                    if not chunk:
                        break
                    remaining -= len(chunk)
                    yield chunk
        return Response(gen_range(), status=206, mimetype=mime, headers={
            "Content-Range":       f"bytes {start}-{end}/{file_size}",
            "Accept-Ranges":       "bytes",
            "Content-Length":      str(length),
            "Content-Disposition": f'attachment; filename="{filename}"',
        })
    return Response(read_stream(path), mimetype=mime, headers={
        "Accept-Ranges":       "bytes",
        "Content-Length":      str(file_size),
        "Content-Disposition": f'attachment; filename="{filename}"',
    })
@app.route("/download-all/<session_id>")
def download_all(session_id):
    folder = os.path.join(app.config["COMPRESSED_FOLDER"], session_id)
    if not os.path.exists(folder):
        return {"error": "Session not found"}, 404
    zip_path = os.path.join(app.config["COMPRESSED_FOLDER"], f"{session_id}.zip")
    with zipfile.ZipFile(zip_path, "w", zipfile.ZIP_STORED) as zf:
        for fname in os.listdir(folder):
            zf.write(os.path.join(folder, fname), fname)
    return Response(read_stream(zip_path), mimetype="application/zip", headers={
        "Content-Length":      str(os.path.getsize(zip_path)),
        "Content-Disposition": 'attachment; filename="compressed_files.zip"',
    })
@app.route("/cleanup/<session_id>", methods=["DELETE"])
def cleanup_session(session_id):
    folder   = os.path.join(app.config["COMPRESSED_FOLDER"], session_id)
    zip_path = os.path.join(app.config["COMPRESSED_FOLDER"], f"{session_id}.zip")
    removed  = []
    if os.path.exists(folder):   shutil.rmtree(folder); removed.append("files")
    if os.path.exists(zip_path): os.remove(zip_path);   removed.append("zip")
    if not removed:
        return {"error": "Session not found"}, 404
    return {"ok": True, "removed": removed}
@app.route("/")
def index():
    return render_template("index.html")
if __name__ == "__main__":
    try:
        import qrcode
        def print_qr(url):
            qr = qrcode.QRCode(border=1)
            qr.add_data(url)
            qr.make(fit=True)
            qr.print_ascii(invert=True)
    except ImportError:
        def print_qr(url): pass
    ip = get_local_ip()
    print(f"\n  Local:   http://127.0.0.1:5000")
    print(f"  Network: http://{ip}:5000\n")
    print("  Scan to open on your phone:\n")
    print_qr(f"http://{ip}:5000")
    print()
    app.run(host="0.0.0.0", port=5000, debug=False, use_reloader=False, threaded=True)