const { setGlobalOptions } = require("firebase-functions/v2");
const { onRequest } = require("firebase-functions/v2/https");
const logger = require("firebase-functions/logger");

const admin = require("firebase-admin");
const vision = require("@google-cloud/vision");

admin.initializeApp();
setGlobalOptions({ maxInstances: 10, region: "us-central1" });

const visionClient = new vision.ImageAnnotatorClient();

// ✅ sanity test: proves functions deploy and can be hit
exports.ping = onRequest((req, res) => {
  res.json({ ok: true, msg: "pong" });
});

// ✅ Vision endpoint (basic)
exports.detectCard = onRequest(async (req, res) => {
  // Simple CORS for dev
  res.set("Access-Control-Allow-Origin", "*");
  res.set("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.set("Access-Control-Allow-Headers", "Content-Type, Authorization");

  if (req.method === "OPTIONS") return res.status(204).send("");
  if (req.method !== "POST") return res.status(405).json({ error: "Use POST" });

  try {
    // Require Firebase Auth (recommended)
    const authHeader = req.headers.authorization || "";
    const idToken = authHeader.startsWith("Bearer ")
      ? authHeader.slice(7)
      : null;

    if (!idToken) {
      return res.status(401).json({ error: "Missing Authorization bearer token" });
    }

    const decoded = await admin.auth().verifyIdToken(idToken);
    const uid = decoded.uid;

    const { imageBase64 } = req.body || {};
    if (!imageBase64) {
      return res.status(400).json({ error: "Missing imageBase64" });
    }

    const base64 = imageBase64.includes("base64,")
      ? imageBase64.split("base64,")[1]
      : imageBase64;

    const [result] = await visionClient.annotateImage({
      image: { content: base64 },
      features: [
        { type: "WEB_DETECTION", maxResults: 10 },
        { type: "LABEL_DETECTION", maxResults: 10 },
      ],
    });

    const web = result.webDetection || {};
    const webEntities = (web.webEntities || [])
      .map((e) => ({ description: e.description, score: e.score }))
      .filter((e) => e.description);

    const labels = (result.labelAnnotations || [])
      .map((l) => ({ description: l.description, score: l.score }))
      .filter((l) => l.description);

    return res.json({ uid, webEntities, labels });
  } catch (err) {
    logger.error(err);
    return res.status(500).json({ error: "Vision request failed" });
  }
});
