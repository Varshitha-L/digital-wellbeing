import time
import json
import psutil
import win32gui
import win32process
from flask import Flask, jsonify
import threading
import atexit
from ctypes import Structure, windll, c_uint, sizeof, byref
TRACK_INTERVAL = 1         
IDLE_THRESHOLD = 60        
SAVE_INTERVAL = 30         
DATA_FILE = "usage_data.json"
SOCIAL_APPS = [
    "instagram", "facebook", "tiktok",
    "youtube", "twitter", "snapchat"
]
app = Flask(__name__)

usage_data = {}
current_app = None
last_time = time.time()
lock = threading.Lock()

# ---------------- Idle Detection ----------------
class LASTINPUTINFO(Structure):
    _fields_ = [("cbSize", c_uint), ("dwTime", c_uint)]

def get_idle_time():
    lii = LASTINPUTINFO()
    lii.cbSize = sizeof(LASTINPUTINFO)
    windll.user32.GetLastInputInfo(byref(lii))
    millis = windll.kernel32.GetTickCount() - lii.dwTime
    return millis / 1000.0

# ---------------- Core Logic ----------------
def get_active_app():
    try:
        hwnd = win32gui.GetForegroundWindow()
        _, pid = win32process.GetWindowThreadProcessId(hwnd)
        return psutil.Process(pid).name().lower()
    except:
        return "unknown"

def flush_current(now):
    global last_time
    if current_app:
        duration = int(now - last_time)
        usage_data[current_app] = usage_data.get(current_app, 0) + duration

def track_usage():
    global current_app, last_time

    while True:
        time.sleep(TRACK_INTERVAL)

        if get_idle_time() > IDLE_THRESHOLD:
            continue

        app_name = get_active_app()
        now = time.time()

        with lock:
            if current_app is None:
                current_app = app_name
                last_time = now
                continue

            if app_name != current_app:
                flush_current(now)
                current_app = app_name
                last_time = now

def autosave():
    while True:
        time.sleep(SAVE_INTERVAL)
        with lock:
            with open(DATA_FILE, "w") as f:
                json.dump(usage_data, f)

def load_data():
    global usage_data
    try:
        with open(DATA_FILE, "r") as f:
            usage_data = json.load(f)
    except:
        usage_data = {}

def shutdown():
    with lock:
        flush_current(time.time())
        with open(DATA_FILE, "w") as f:
            json.dump(usage_data, f)

atexit.register(shutdown)

# ---------------- API ----------------
@app.route("/api/usage")
def get_usage():
    with lock:
        total = sum(usage_data.values())
        apps = []

        social_time = 0
        for app, seconds in usage_data.items():
            is_social = any(s in app for s in SOCIAL_APPS)
            if is_social:
                social_time += seconds

            apps.append({
                "app": app,
                "seconds": seconds,
                "is_social": is_social
            })

    return jsonify({
        "total_seconds": total,
        "social_seconds": social_time,
        "non_social_seconds": total - social_time,
        "apps": sorted(apps, key=lambda x: x["seconds"], reverse=True)
    })

# ---------------- Startup ----------------
def run_flask():
    app.run(port=5001, debug=False)

if __name__ == "__main__":
    load_data()
    threading.Thread(target=track_usage, daemon=True).start()
    threading.Thread(target=autosave, daemon=True).start()
    run_flask()










