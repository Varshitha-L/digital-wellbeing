import time
import psutil
import win32gui
import win32process
from flask import Flask, jsonify
import threading

app = Flask(__name__)

usage_data = {}
current_app = None
last_time = time.time()

SOCIAL_APPS = ["instagram", "facebook", "tiktok", "youtube", "twitter", "snapchat"]

def get_active_app():
    try:
        hwnd = win32gui.GetForegroundWindow()
        _, pid = win32process.GetWindowThreadProcessId(hwnd)
        process = psutil.Process(pid)
        return process.name().lower()
    except:
        return "unknown"

def track_usage():
    global current_app, last_time

    while True:
        app_name = get_active_app()
        now = time.time()

        if current_app is None:
            current_app = app_name
            last_time = now

        if app_name != current_app:
            duration = int(now - last_time)
            usage_data[current_app] = usage_data.get(current_app, 0) + duration

            current_app = app_name
            last_time = now

        time.sleep(1)

@app.route("/api/usage")
def get_usage():
    formatted = []
    for app, seconds in usage_data.items():
        formatted.append({
            "app": app,
            "seconds": seconds,
            "is_social": any(s in app for s in SOCIAL_APPS)
        })
    return jsonify(formatted)

def run_flask():
    app.run(port=5001, debug=False)

if __name__ == "__main__":
    threading.Thread(target=track_usage).start()
    run_flask()
