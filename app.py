import os, shutil, socket, qrcode, json, uuid, mimetypes, subprocess, zipfile
from flask import Flask, request, jsonify, send_file, render_template, Response, stream_with_context
from flask_cors import CORS
from PIL import Image

app = Flask(__name__)
CORS(app, origins="*")
app.config["UPLOAD_FOLDER"] = "uploads"
app.config["COMPRESSED_FOLDER"] = "compressed"
app.config["MAX_CONTENT_LENGTH"] = None
app.config["MAX_FORM_MEMORY_SIZE"] = None

os.makedirs(app.config["UPLOAD_FOLDER"], exist_ok=True)
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

def print_qr(url):
    qr = qrcode.QRCode(border=1)
    qr.add_data(url)
    qr.make(fit=True)
    qr.print_ascii(invert=True)

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
        img.save(output_path, optimize=True)

def compress_video(input_path, output_path):
    cmd = ["ffmpeg", "-i", input_path, "-vcodec", "libx264", "-crf", "28", "-preset", "fast", "-acodec", "aac", "-b:a", "128k", "-movflags", "+faststart", "-y", output_path]
    return subprocess.run(cmd, capture_output=True, timeout=600).returncode == 0

def compress_audio(input_path, output_path):
    cmd = ["ffmpeg", "-i", input_path, "-b:a", "128k", "-y", output_path]
    return subprocess.run(cmd, capture_output=True, timeout=300).returncode == 0

IMAGE_EXTS = {"jpg", "jpeg", "png", "webp", "bmp", "tiff", "gif"}
VIDEO_EXTS = {"mp4", "mov", "avi", "mkv", "webm", "flv", "wmv", "m4v"}
AUDIO_EXTS = {"mp3", "wav", "flac", "aac", "ogg", "m4a", "wma"}

def emit(obj):
    return json.dumps(obj) + "\n"

@app.route("/")
def index():
    return render_template("index.html")

@app.route("/compress", methods=["POST"])
def compress():
    if "files" not in request.files:
        return jsonify({"error": "No files provided"}), 400
    files = request.files.getlist("files")
    session_id = str(uuid.uuid4())
    session_compressed = os.path.join(app.config["COMPRESSED_FOLDER"], session_id)
    os.makedirs(session_compressed, exist_ok=True)
    total_original = sum(0 for _ in files)

    def generate():
        results = []
        saved_files = []
        for f in files:
            if f.filename:
                input_path = os.path.join(app.config["UPLOAD_FOLDER"], f"{session_id}_{f.filename}")
                f.save(input_path)
                saved_files.append((f.filename, input_path))

        total_original_size = sum(os.path.getsize(p) for _, p in saved_files)
        yield emit({"type": "start", "total_files": len(saved_files), "total_original_size": total_original_size})

        total_compressed_size = 0
        for idx, (filename, input_path) in enumerate(saved_files):
            ext = filename.rsplit(".", 1)[-1].lower() if "." in filename else ""
            original_size = os.path.getsize(input_path)
            yield emit({"type": "progress", "file": filename, "index": idx, "total": len(saved_files), "original_size": original_size})
            try:
                if ext in IMAGE_EXTS:
                    out_ext = ext if ext in ("jpg", "jpeg", "png", "webp") else "jpg"
                    out_name = filename.rsplit(".", 1)[0] + "." + out_ext if "." in filename else filename + "." + out_ext
                    output_path = os.path.join(session_compressed, out_name)
                    compress_image(input_path, output_path, filename)
                    compressed_size = os.path.getsize(output_path)
                    total_compressed_size += compressed_size
                    r = {"name": out_name, "original": filename, "original_size": original_size, "compressed_size": compressed_size, "status": "ok"}
                elif ext in VIDEO_EXTS:
                    out_name = filename.rsplit(".", 1)[0] + ".mp4" if "." in filename else filename + ".mp4"
                    output_path = os.path.join(session_compressed, out_name)
                    ok = compress_video(input_path, output_path)
                    if ok and os.path.exists(output_path):
                        compressed_size = os.path.getsize(output_path)
                        total_compressed_size += compressed_size
                        r = {"name": out_name, "original": filename, "original_size": original_size, "compressed_size": compressed_size, "status": "ok"}
                    else:
                        r = {"name": filename, "original": filename, "original_size": original_size, "compressed_size": 0, "status": "error", "error": "ffmpeg failed"}
                elif ext in AUDIO_EXTS:
                    out_name = filename.rsplit(".", 1)[0] + ".mp3" if "." in filename else filename + ".mp3"
                    output_path = os.path.join(session_compressed, out_name)
                    ok = compress_audio(input_path, output_path)
                    if ok and os.path.exists(output_path):
                        compressed_size = os.path.getsize(output_path)
                        total_compressed_size += compressed_size
                        r = {"name": out_name, "original": filename, "original_size": original_size, "compressed_size": compressed_size, "status": "ok"}
                    else:
                        r = {"name": filename, "original": filename, "original_size": original_size, "compressed_size": 0, "status": "error", "error": "ffmpeg failed"}
                else:
                    r = {"name": filename, "original": filename, "original_size": original_size, "compressed_size": 0, "status": "unsupported"}
            except Exception as e:
                r = {"name": filename, "original": filename, "original_size": original_size, "compressed_size": 0, "status": "error", "error": str(e)}
            results.append(r)
            yield emit({"type": "file_done", "result": r, "total_compressed_size": total_compressed_size})
            os.remove(input_path)

        yield emit({"type": "done", "session_id": session_id, "results": results, "total_original_size": total_original_size, "total_compressed_size": total_compressed_size})

    return Response(stream_with_context(generate()), mimetype="application/x-ndjson")

@app.route("/download/<session_id>/<filename>")
def download_file(session_id, filename):
    path = os.path.join(app.config["COMPRESSED_FOLDER"], session_id, filename)
    if not os.path.exists(path):
        return jsonify({"error": "File not found"}), 404
    mime = mimetypes.guess_type(path)[0] or "application/octet-stream"
    return send_file(path, mimetype=mime, as_attachment=True, download_name=filename)

@app.route("/download-all/<session_id>")
def download_all(session_id):
    folder = os.path.join(app.config["COMPRESSED_FOLDER"], session_id)
    if not os.path.exists(folder):
        return jsonify({"error": "Session not found"}), 404
    zip_path = os.path.join(app.config["COMPRESSED_FOLDER"], f"{session_id}.zip")
    with zipfile.ZipFile(zip_path, "w", zipfile.ZIP_DEFLATED) as zf:
        for fname in os.listdir(folder):
            zf.write(os.path.join(folder, fname), fname)
    return send_file(zip_path, mimetype="application/zip", as_attachment=True, download_name="compressed_files.zip")

@app.route("/cleanup/<session_id>", methods=["DELETE"])
def cleanup_session(session_id):
    folder = os.path.join(app.config["COMPRESSED_FOLDER"], session_id)
    zip_path = os.path.join(app.config["COMPRESSED_FOLDER"], f"{session_id}.zip")
    removed = []
    if os.path.exists(folder):
        shutil.rmtree(folder)
        removed.append("files")
    if os.path.exists(zip_path):
        os.remove(zip_path)
        removed.append("zip")
    if not removed:
        return jsonify({"error": "Session not found"}), 404
    return jsonify({"ok": True, "removed": removed})

if __name__ == "__main__":
    ip = get_local_ip()
    network_url = f"http://{ip}:5000"
    print(f"\n  Local:   http://127.0.0.1:5000")
    print(f"  Network: {network_url}\n")
    print(f"  Scan to open on your phone:\n")
    print_qr(network_url)
    print()
    app.run(host="0.0.0.0", port=5000, debug=True, use_reloader=False)