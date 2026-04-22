import os
import socket
from flask import Flask, request, jsonify, send_file, render_template
from flask_cors import CORS
from PIL import Image
import subprocess
import zipfile
import uuid
import mimetypes

app = Flask(__name__)
CORS(app, origins="*")
app.config["UPLOAD_FOLDER"] = "uploads"
app.config["COMPRESSED_FOLDER"] = "compressed"
app.config["MAX_CONTENT_LENGTH"] = 4 * 1024 * 1024 * 1024

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
    cmd = [
        "ffmpeg", "-i", input_path,
        "-vcodec", "libx264",
        "-crf", "28",
        "-preset", "fast",
        "-acodec", "aac",
        "-b:a", "128k",
        "-movflags", "+faststart",
        "-y", output_path
    ]
    result = subprocess.run(cmd, capture_output=True, timeout=600)
    return result.returncode == 0

def compress_audio(input_path, output_path):
    cmd = [
        "ffmpeg", "-i", input_path,
        "-b:a", "128k",
        "-y", output_path
    ]
    result = subprocess.run(cmd, capture_output=True, timeout=300)
    return result.returncode == 0

IMAGE_EXTS = {"jpg", "jpeg", "png", "webp", "bmp", "tiff", "gif"}
VIDEO_EXTS = {"mp4", "mov", "avi", "mkv", "webm", "flv", "wmv", "m4v"}
AUDIO_EXTS = {"mp3", "wav", "flac", "aac", "ogg", "m4a", "wma"}

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
    results = []
    for f in files:
        if not f.filename:
            continue
        ext = f.filename.rsplit(".", 1)[-1].lower() if "." in f.filename else ""
        original_name = f.filename
        input_path = os.path.join(app.config["UPLOAD_FOLDER"], f"{session_id}_{original_name}")
        f.save(input_path)
        original_size = os.path.getsize(input_path)
        if ext in IMAGE_EXTS:
            out_ext = ext if ext in ("jpg", "jpeg", "png", "webp") else "jpg"
            out_name = original_name.rsplit(".", 1)[0] + "." + out_ext if "." in original_name else original_name + "." + out_ext
            output_path = os.path.join(session_compressed, out_name)
            try:
                compress_image(input_path, output_path, original_name)
                compressed_size = os.path.getsize(output_path)
                results.append({"name": out_name, "original": original_name, "original_size": original_size, "compressed_size": compressed_size, "status": "ok"})
            except Exception as e:
                results.append({"name": original_name, "original": original_name, "original_size": original_size, "compressed_size": 0, "status": "error", "error": str(e)})
        elif ext in VIDEO_EXTS:
            out_name = original_name.rsplit(".", 1)[0] + ".mp4" if "." in original_name else original_name + ".mp4"
            output_path = os.path.join(session_compressed, out_name)
            try:
                ok = compress_video(input_path, output_path)
                if ok and os.path.exists(output_path):
                    compressed_size = os.path.getsize(output_path)
                    results.append({"name": out_name, "original": original_name, "original_size": original_size, "compressed_size": compressed_size, "status": "ok"})
                else:
                    results.append({"name": original_name, "original": original_name, "original_size": original_size, "compressed_size": 0, "status": "error", "error": "ffmpeg failed"})
            except Exception as e:
                results.append({"name": original_name, "original": original_name, "original_size": original_size, "compressed_size": 0, "status": "error", "error": str(e)})
        elif ext in AUDIO_EXTS:
            out_name = original_name.rsplit(".", 1)[0] + ".mp3" if "." in original_name else original_name + ".mp3"
            output_path = os.path.join(session_compressed, out_name)
            try:
                ok = compress_audio(input_path, output_path)
                if ok and os.path.exists(output_path):
                    compressed_size = os.path.getsize(output_path)
                    results.append({"name": out_name, "original": original_name, "original_size": original_size, "compressed_size": compressed_size, "status": "ok"})
                else:
                    results.append({"name": original_name, "original": original_name, "original_size": original_size, "compressed_size": 0, "status": "error", "error": "ffmpeg failed"})
            except Exception as e:
                results.append({"name": original_name, "original": original_name, "original_size": original_size, "compressed_size": 0, "status": "error", "error": str(e)})
        else:
            results.append({"name": original_name, "original": original_name, "original_size": original_size, "compressed_size": 0, "status": "unsupported"})
        os.remove(input_path)
    return jsonify({"session_id": session_id, "results": results})

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

if __name__ == "__main__":
    ip = get_local_ip()
    print(f"\n  Local:   http://127.0.0.1:5000")
    print(f"  Network: http://{ip}:5000\n")
    app.run(host="0.0.0.0", port=5000, debug=True)