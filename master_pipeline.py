import os
import sys
import time
import logging
import requests
import subprocess
import xml.etree.ElementTree as ET
from urllib.parse import quote

# --- CONFIGURATION ---
STREAMP2P_API_KEY = "46d3af3546d3931092a5b078"
STREAMP2P_API_BASE = "https://streamp2p.com/api/v1"
NYAA_RSS_BASE = "https://nyaa.si/?page=rss"
DOWNLOAD_DIR = "downloads"
OUTPUT_DIR = "processed"
WATERMARK_TEXT = "DCAIM"
CRF = 18
FFMPEG_PRESET = "slow"

# --- LOGGING ---
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')
logger = logging.getLogger("AniversePipeline")

# --- NYAA SEARCH ---
def search_nyaa(query):
    url = f"{NYAA_RSS_BASE}&q={quote(query)}&c=0_0&f=0"
    logger.info(f"Searching Nyaa: {url}")
    try:
        r = requests.get(url, timeout=15)
        root = ET.fromstring(r.content)
        items = []
        for item in root.findall('.//item'):
            title = item.find('title').text
            link = item.find('link').text
            desc = item.find('description').text
            seeders = 0
            if "Seeders:" in desc:
                try: seeders = int(desc.split("Seeders:")[1].split(",")[0].strip())
                except: pass
            items.append({'title': title, 'torrent_url': link, 'seeders': seeders})
        items.sort(key=lambda x: x['seeders'], reverse=True)
        return items
    except Exception as e:
        logger.error(f"Search error: {e}")
        return []

# --- DOWNLOAD ---
def download_torrent(url, anime_name):
    target = os.path.join(DOWNLOAD_DIR, anime_name.replace(" ", "_"))
    os.makedirs(target, exist_ok=True)
    cmd = ["aria2c", "--seed-time=0", f"--dir={target}", "--max-overall-download-limit=0", "--follow-torrent=mem", url]
    logger.info(f"Downloading to {target}...")
    try:
        subprocess.run(cmd, check=True)
        files = []
        for root, _, filenames in os.walk(target):
            for f in filenames:
                if not f.endswith((".aria2", ".torrent")):
                    files.append(os.path.join(root, f))
        return files
    except Exception as e:
        logger.error(f"Download error: {e}")
        return []

# --- VIDEO PROCESSING ---
def process_video(input_path, anime_name):
    filename = os.path.basename(input_path)
    output_name = os.path.splitext(filename)[0] + ".mp4"
    target_dir = os.path.join(OUTPUT_DIR, anime_name.replace(" ", "_"))
    os.makedirs(target_dir, exist_ok=True)
    output_path = os.path.join(target_dir, output_name)
    
    vf = f"scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2,drawtext=text='{WATERMARK_TEXT}':fontsize=24:fontcolor=white@0.3:x=W-tw-10:y=10"
    cmd = ["ffmpeg", "-y", "-i", input_path, "-vf", vf, "-c:v", "libx264", "-crf", str(CRF), "-preset", FFMPEG_PRESET, "-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart", output_path]
    
    logger.info(f"Processing: {filename}")
    try:
        subprocess.run(cmd, check=True, capture_output=True)
        return output_path
    except Exception as e:
        logger.error(f"FFmpeg error: {e}")
        return None

# --- STREAMP2P UPLOAD ---
class StreamP2P:
    def __init__(self):
        self.headers = {"api-token": STREAMP2P_API_KEY}
        self.base = STREAMP2P_API_BASE

    def ensure_path(self, parts):
        parent = 0
        for part in parts:
            folders = requests.get(f"{self.base}/video/folder", headers=self.headers).json()
            if not isinstance(folders, list): folders = folders.get('data', [])
            match = next((f for f in folders if f['name'] == part and (f['parentId'] == parent or (parent == 0 and f['parentId'] is None))), None)
            if match: parent = match['id']
            else:
                res = requests.post(f"{self.base}/video/folder", headers=self.headers, data={"name": part, "parentId": parent}).json()
                parent = res.get('data', {}).get('id')
        return parent

    def upload(self, file_path, folder_id):
        logger.info(f"Uploading {os.path.basename(file_path)}...")
        try:
            with open(file_path, 'rb') as f:
                r = requests.post(f"{self.base}/video/upload", headers=self.headers, files={'file': f}, data={'folderId': folder_id})
                return r.json().get('data', {}).get('id')
        except Exception as e:
            logger.error(f"Upload error: {e}")
            return None

# --- MASTER ORCHESTRATOR ---
def run_pipeline(title):
    logger.info(f"=== Starting: {title} ===")
    results = search_nyaa(f"{title} 1080p") or search_nyaa(title)
    if not results: return
    
    files = download_torrent(results[0]['torrent_url'], title)
    if not files: return
    
    sp2p = StreamP2P()
    fid = sp2p.ensure_path(["Anime", title, "SoftSub"])
    
    for f in files:
        if f.lower().endswith(('.mp4', '.mkv', '.avi')):
            proc = process_video(f, title)
            if proc:
                vid = sp2p.upload(proc, fid)
                if vid: logger.info(f"Uploaded! ID: {vid}")
                if os.path.exists(proc): os.remove(proc)
    logger.info(f"=== Finished: {title} ===")

if __name__ == "__main__":
    if len(sys.argv) > 1:
        run_pipeline(" ".join(sys.argv[1:]))
    else:
        print("Usage: python master_pipeline.py <anime_title>")
