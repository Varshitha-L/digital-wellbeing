<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <title>Digital Wellness</title>
  <link rel="stylesheet" href="style.css">
</head>
<body>
  <div id="app">
    <header>
      <h1>Digital Wellness — Desktop Monitor</h1>
    </header>

    <main>
      <section id="controls">
        <div class="buttons">
          <button id="btn-start">Start Monitoring</button>
          <button id="btn-stop">Stop Monitoring</button>
          <button id="btn-reset">Reset Counters</button>
        </div>

        <div class="settings">
          <label>Alert threshold (minutes):
            <input type="number" id="threshold" min="1" value="20">
          </label>
          <label>
            Auto-start on app launch:
            <input type="checkbox" id="autostart">
          </label>
          <button id="saveSettings">Save Settings</button>
        </div>
      </section>

      <section id="live">
        <h2>Live Activity</h2>
        <div id="liveCards"></div>
      </section>

      <section id="history">
        <h2>Session History</h2>
        <div id="historyList"></div>
        <button id="exportBtn">Export report.json</button>
      </section>
    </main>

    <footer>
      <small>App runs offline and monitors active window for social usage</small>
    </footer>
  </div>

  <script src="renderer.js"></script>
</body>
</html>
