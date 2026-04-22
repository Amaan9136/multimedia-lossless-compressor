# Squish — Media Compressor

Compress images, videos, and audio files with minimal quality loss directly from your browser. Works on both desktop and mobile — open from any device on the same network.

## Features

- Drag & drop or tap to upload — unlimited files at once
- Images: JPG, PNG, WEBP, BMP, TIFF, GIF
- Videos: MP4, MOV, AVI, MKV, WEBM, FLV, WMV, M4V
- Audio: MP3, WAV, FLAC, AAC, OGG, M4A, WMA
- Download files individually or all as a ZIP
- Mobile tip to delete originals after downloading
- Accessible from any device on your local network

## Requirements

- Python 3.8+
- ffmpeg installed on the system

### Install ffmpeg

**macOS:**
```bash
brew install ffmpeg
```

**Ubuntu/Debian:**
```bash
sudo apt install ffmpeg
```

**Windows:**
Download from https://ffmpeg.org/download.html and add to PATH.

## Setup

```bash
pip install -r requirements.txt
python app.py
```

The terminal will print both local and network URLs:

```
  Local:   http://127.0.0.1:5000
  Network: http://192.168.x.x:5000
```

Open the Network URL on any device (phone, tablet, etc.) connected to the same Wi-Fi.

## Compression Settings

| Type   | Method                          | Notes                        |
|--------|---------------------------------|------------------------------|
| JPEG   | Pillow quality=72, progressive  | Typically 40–70% smaller     |
| PNG    | Pillow optimize, compress_level=9 | Lossless                   |
| WEBP   | Pillow quality=72               | Best ratio for web images    |
| Video  | H.264 CRF 28, AAC 128k          | 30–60% smaller, fast preset  |
| Audio  | AAC/MP3 128k                    | Good quality, small size     |

## Project Structure

```
compressor/
├── app.py
├── requirements.txt
├── README.md
├── templates/
│   └── index.html
├── static/
│   ├── css/style.css
│   └── js/app.js
├── uploads/        (temp, auto-created)
└── compressed/     (output, auto-created)
```