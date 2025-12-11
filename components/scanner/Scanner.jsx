// src/components/scanner/Scanner.jsx
import React, { useEffect, useState, useRef } from "react";
import Tesseract from "tesseract.js";
import "./Scanner.css";

import { useAuth } from "../../src/AuthContext";
import { db } from "../../src/firebase";
import {
  doc,
  setDoc,
  serverTimestamp,
  collection,
  onSnapshot,
} from "firebase/firestore";

// All Pokémon names in multiple languages
// { en: { "bulbasaur": 1, ... }, ja: { "オーベム": 606, ... }, ko: {...}, fr: {...}, de: {...} }
import pokemonNames from "../../src/pokemon-names.json";

const MAX_POKEMON = 1025;

// Phase 1: language detection
const OCR_LANGS_MULTI = "eng+jpn+kor+fra+deu";

// Phase 2: per-language OCR
const LANG_CODE_TO_TESSERACT = {
  en: "eng",
  ja: "jpn",
  ko: "kor",
  fr: "fra",
  de: "deu",
};

// Only scan the top X% of the card frame to focus on the name area
const NAME_BAND_RATIO = 0.2; // top 20%

// 🔁 Number of distinct frames to capture from the camera
const FRAME_SAMPLES = 3; // bump to 5 if you want, at the cost of more OCR time

// --- Helpers ---

function prettyLanguage(langCode) {
  switch (langCode) {
    case "ja":
      return "Japanese";
    case "ko":
      return "Korean";
    case "fr":
      return "French";
    case "de":
      return "German";
    case "en":
      return "English";
    default:
      return "Unknown";
  }
}

// Simple language detection: JA / KO by script, FR/DE by accents, else EN (Latin)
function detectLanguageFromText(text) {
  if (!text) return "en";

  let hasHiraganaOrKatakana = false;
  let hasHangul = false;
  let hasFrAccent = false;
  let hasDeAccent = false;

  const frChars = "éèàçêëïîôâùû";
  const deChars = "äöüßÄÖÜ";

  for (const ch of text) {
    const code = ch.codePointAt(0);

    // Hiragana: 3040–309F
    if (code >= 0x3040 && code <= 0x309F) {
      hasHiraganaOrKatakana = true;
      continue;
    }
    // Katakana: 30A0–30FF
    if (code >= 0x30A0 && code <= 0x30FF) {
      hasHiraganaOrKatakana = true;
      continue;
    }
    // Hangul syllables: AC00–D7AF
    if (code >= 0xAC00 && code <= 0xD7AF) {
      hasHangul = true;
      continue;
    }

    if (frChars.includes(ch)) {
      hasFrAccent = true;
    }
    if (deChars.includes(ch)) {
      hasDeAccent = true;
    }
  }

  if (hasHangul) return "ko";
  if (hasHiraganaOrKatakana) return "ja";
  if (hasFrAccent) return "fr";
  if (hasDeAccent) return "de";

  // Fallback: Latin script, treat as English for now
  return "en";
}

// Majority vote helper
function majorityVote(values) {
  const counts = {};
  let bestValue = null;
  let bestCount = 0;

  values.forEach((v) => {
    if (!v) return;
    counts[v] = (counts[v] || 0) + 1;
    if (counts[v] > bestCount) {
      bestCount = counts[v];
      bestValue = v;
    }
  });

  return bestValue;
}

// Get language-specific name map from pokemonNames.json
function getNameMapForLang(langCode) {
  const map = pokemonNames[langCode];
  if (map && Object.keys(map).length > 0) return map;

  // Fallback to English if something goes wrong
  return pokemonNames.en || {};
}

// Normalize text per language for matching
function normalizeForMatching(text, langCode) {
  if (!text) return "";

  if (langCode === "ja" || langCode === "ko") {
    // For Japanese/Korean, spaces are often OCR noise.
    // Remove all whitespace characters.
    return text.replace(/\s+/g, "");
  }

  // Latin languages: lowercase and normalize spaces a bit.
  return text
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

// Find best Pokémon match in OCR text using a specific language’s name map
function findBestPokemonMatch(rawText, nameMap, langCode) {
  if (!rawText || !nameMap) return null;

  const textNorm = normalizeForMatching(rawText, langCode);

  let bestName = null;
  let bestDex = null;
  let bestScore = 0;

  for (const [name, dex] of Object.entries(nameMap)) {
    if (!dex || dex < 1 || dex > MAX_POKEMON) continue;

    let candidateNorm = normalizeForMatching(name, langCode);
    if (!candidateNorm) continue;

    if (textNorm.includes(candidateNorm)) {
      // Longer matches are more specific; use length as score
      const score = candidateNorm.length;
      if (score > bestScore) {
        bestScore = score;
        bestName = name;
        bestDex = dex;
      }
    }
  }

  if (!bestName) return null;
  return { name: bestName, dexNumber: bestDex, score: bestScore };
}

export default function Scanner() {
  const { user } = useAuth();

  // File-based scanning state
  const [imageFile, setImageFile] = useState(null);
  const [imagePreviewUrl, setImagePreviewUrl] = useState(null);

  // Owned tracking (so we can say “already in your collection”)
  const [ownedDex, setOwnedDex] = useState({});

  // Scan state
  const [scanning, setScanning] = useState(false);
  const [detectedLanguage, setDetectedLanguage] = useState(null);
  const [statusMessage, setStatusMessage] = useState("");
  const [scanError, setScanError] = useState(null);
  const [ocrText, setOcrText] = useState("");

  // Camera state
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const frameRef = useRef(null); // CSS frame overlay

  const [cameraActive, setCameraActive] = useState(false);
  const [cameraReady, setCameraReady] = useState(false);
  const [cameraError, setCameraError] = useState(null);

  // --- Subscribe to user's collection ---
  useEffect(() => {
    if (!user) {
      setOwnedDex({});
      return;
    }

    const colRef = collection(db, "users", user.uid, "collection");

    const unsubscribe = onSnapshot(
      colRef,
      (snapshot) => {
        const map = {};
        snapshot.forEach((docSnap) => {
          const data = docSnap.data();
          const dex =
            data.dexNumber ?? Number.parseInt(docSnap.id, 10) ?? null;
          if (dex && dex >= 1 && dex <= MAX_POKEMON) {
            map[dex] = true;
          }
        });
        setOwnedDex(map);
      },
      (error) => {
        console.error("Failed to read collection for scanner:", error);
        setOwnedDex({});
      }
    );

    return () => unsubscribe();
  }, [user]);

  // --- Camera start/stop helpers ---
  const stopCameraStream = () => {
    const video = videoRef.current;
    if (video && video.srcObject) {
      const tracks = video.srcObject.getTracks();
      tracks.forEach((t) => t.stop());
      video.srcObject = null;
    }
    setCameraReady(false);
  };

  const startCameraStream = async () => {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      setCameraError("Camera is not supported in this browser.");
      return;
    }

    try {
      setCameraError(null);
      setCameraReady(false);

      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "environment" },
        audio: false,
      });

      const video = videoRef.current;
      if (!video) {
        console.warn("Video element not mounted yet.");
        return;
      }

      video.srcObject = stream;

      video
        .play()
        .then(() => {
          setCameraReady(true);
        })
        .catch((err) => {
          console.error("Video play() failed:", err);
          setCameraError(
            "Camera stream started, but could not be played. Try reloading the page."
          );
        });
    } catch (err) {
      console.error("Failed to start camera:", err);
      setCameraError("Could not access camera. Check permissions.");
    }
  };

  // React to cameraActive changes
  useEffect(() => {
    if (cameraActive) {
      startCameraStream();
    } else {
      stopCameraStream();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cameraActive]);

  // Clean up camera on unmount
  useEffect(() => {
    return () => {
      stopCameraStream();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // --- File selection ---
  const handleFileChange = (e) => {
    const file = e.target.files && e.target.files[0];
    if (!file) return;

    setImageFile(file);
    setScanError(null);
    setStatusMessage("");
    setOcrText("");
    setDetectedLanguage(null);

    const url = URL.createObjectURL(file);
    setImagePreviewUrl(url);
  };

  // --- OCR helpers ---

  async function ocrOnce(imageUrl, langs) {
    const result = await Tesseract.recognize(imageUrl, langs, {
      logger: () => {
        // optional progress
      },
    });
    return result?.data?.text || "";
  }

  // Phase 1: run OCR 3 times, vote on language
  async function detectLanguageWithVoting(imageUrl) {
    const langVotes = [];

    for (let i = 0; i < 3; i++) {
      const text = await ocrOnce(imageUrl, OCR_LANGS_MULTI);
      const langCode = detectLanguageFromText(text);
      langVotes.push(langCode);
    }

    const votedLang = majorityVote(langVotes) || "en";
    return votedLang;
  }

  // Phase 2: run OCR 3 times with chosen language, vote on Pokémon name
  async function detectPokemonWithLang(imageUrl, langCode) {
    const tesseractLang = LANG_CODE_TO_TESSERACT[langCode] || "eng";
    const nameMap = getNameMapForLang(langCode);

    const matches = [];
    let lastText = "";

    for (let i = 0; i < 3; i++) {
      const text = await ocrOnce(imageUrl, tesseractLang);
      lastText = text || lastText;

      const match = findBestPokemonMatch(text, nameMap, langCode);
      if (match) {
        matches.push(match);
      }
    }

    if (matches.length === 0) {
      return { match: null, lastText };
    }

    // Majority vote by dexNumber within this single image
    const dexCounts = {};
    let bestDex = null;
    let bestCount = 0;

    matches.forEach((m) => {
      dexCounts[m.dexNumber] = (dexCounts[m.dexNumber] || 0) + 1;
      if (dexCounts[m.dexNumber] > bestCount) {
        bestCount = dexCounts[m.dexNumber];
        bestDex = m.dexNumber;
      }
    });

    if (!bestDex) {
      return { match: null, lastText };
    }

    // Pick any match with that dexNumber as representative
    const chosen = matches.find((m) => m.dexNumber === bestDex);

    return { match: chosen || null, lastText };
  }

  // 🔁 Full scan pipeline: now supports multiple imageUrls (frames)
  async function runFullScan(imageInput) {
    const imageUrls = Array.isArray(imageInput) ? imageInput : [imageInput];

    if (!imageUrls.length) {
      setScanError("No image to scan.");
      return;
    }

    setScanning(true);
    setScanError(null);
    setStatusMessage("");
    setOcrText("");
    setDetectedLanguage(null);

    try {
      // 1) Language detection across all frames
      const frameLangs = [];
      for (const url of imageUrls) {
        const langForFrame = await detectLanguageWithVoting(url);
        frameLangs.push(langForFrame);
      }
      const langCode = majorityVote(frameLangs) || "en";
      setDetectedLanguage(langCode);

      const langLabel = prettyLanguage(langCode);

      // 2) Name detection across all frames
      const allMatches = [];
      let lastText = "";

      for (const url of imageUrls) {
        const { match, lastText: t } = await detectPokemonWithLang(
          url,
          langCode
        );
        if (t) lastText = t;
        if (match) allMatches.push(match);
      }

      setOcrText(lastText || "");

      if (!allMatches.length) {
        setStatusMessage(
          `Detected card language as ${langLabel}, but couldn’t confidently read a Pokémon name from the top band.`
        );
        return;
      }

      // Majority vote across *all frames* by dexNumber
      const dexCounts = {};
      let bestDex = null;
      let bestCount = 0;

      allMatches.forEach((m) => {
        dexCounts[m.dexNumber] = (dexCounts[m.dexNumber] || 0) + 1;
        if (dexCounts[m.dexNumber] > bestCount) {
          bestCount = dexCounts[m.dexNumber];
          bestDex = m.dexNumber;
        }
      });

      if (!bestDex) {
        setStatusMessage(
          `Detected card language as ${langLabel}, but couldn’t confidently agree on which Pokémon it is.`
        );
        return;
      }

      const chosen =
        allMatches.find((m) => m.dexNumber === bestDex) || allMatches[0];

      const { name, dexNumber } = chosen;
      const formattedName =
        typeof name === "string"
          ? name.charAt(0).toUpperCase() + name.slice(1)
          : String(name);

      if (!user) {
        setStatusMessage(
          `Detected ${formattedName} (#${dexNumber}) on a ${langLabel} card, but you’re not signed in. Sign in to save it to your collection.`
        );
        return;
      }

      const alreadyOwned = !!ownedDex[dexNumber];

      await setDoc(
        doc(db, "users", user.uid, "collection", String(dexNumber)),
        {
          dexNumber,
          name: formattedName,
          language: langCode,
          addedAt: serverTimestamp(),
        },
        { merge: true }
      );

      if (alreadyOwned) {
        setStatusMessage(
          `Detected ${formattedName} (#${dexNumber}) on a ${langLabel} card. It’s already in your collection.`
        );
      } else {
        setStatusMessage(
          `Detected ${formattedName} (#${dexNumber}) on a ${langLabel} card and added it to your collection!`
        );
      }
    } catch (err) {
      console.error("Failed to scan card:", err);
      setScanError("Something went wrong while scanning this card.");
    } finally {
      setScanning(false);
    }
  }

  // --- File-based scan trigger ---
  const handleScanClick = async () => {
    if (!imageFile && !imagePreviewUrl) {
      setScanError("Please select an image of a card to scan.");
      return;
    }

    if (imagePreviewUrl) {
      await runFullScan(imagePreviewUrl);
    } else if (imageFile) {
      const url = URL.createObjectURL(imageFile);
      setImagePreviewUrl(url);
      await runFullScan(url);
    }
  };

  // --- Camera-based capture + scan (multiple frames, crop + preprocess each) ---
  const handleCaptureAndScan = async () => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    const frame = frameRef.current;

    if (!cameraActive) {
      setCameraError("Camera is not active.");
      return;
    }

    if (!cameraReady) {
      setCameraError(
        "Camera is still initializing. Wait a moment and try again."
      );
      return;
    }

    if (!video || !canvas || !frame) {
      setCameraError("Camera elements are not ready.");
      return;
    }

    const videoWidth = video.videoWidth;
    const videoHeight = video.videoHeight;

    if (!videoWidth || !videoHeight) {
      setCameraError(
        "Camera resolution is not ready yet. Try again in a second."
      );
      return;
    }

    // Get DOM rectangles
    const videoRect = video.getBoundingClientRect();
    const frameRect = frame.getBoundingClientRect();

    // Map CSS pixels -> video pixels
    const scaleX = videoWidth / videoRect.width;
    const scaleY = videoHeight / videoRect.height;

    // Full card frame region in video coordinates
    const frameSx = (frameRect.left - videoRect.left) * scaleX;
    const frameSy = (frameRect.top - videoRect.top) * scaleY;
    const frameWidth = frameRect.width * scaleX;
    const frameHeight = frameRect.height * scaleY;

    // Focus on the top NAME_BAND_RATIO of the card frame
    const sx = frameSx;
    const sy = frameSy; // top of the frame
    const sWidth = frameWidth;
    const sHeight = frameHeight * NAME_BAND_RATIO;

    const ctx = canvas.getContext("2d");
    if (!ctx) {
      setCameraError("Could not get canvas context.");
      return;
    }

    const imageUrls = [];

    for (let i = 0; i < FRAME_SAMPLES; i++) {
      // Scale the cropped region to a reasonable size for OCR
      const targetWidth = 800;
      const scale = sWidth > targetWidth ? targetWidth / sWidth : 1;
      const canvasWidth = sWidth * scale;
      const canvasHeight = sHeight * scale;

      canvas.width = canvasWidth;
      canvas.height = canvasHeight;

      // Draw the cropped region from the video into the canvas
      ctx.drawImage(
        video,
        sx,
        sy,
        sWidth,
        sHeight,
        0,
        0,
        canvasWidth,
        canvasHeight
      );

      // Simple image preprocessing: grayscale + threshold (binarization)
      try {
        const imageData = ctx.getImageData(0, 0, canvasWidth, canvasHeight);
        const data = imageData.data;

        for (let j = 0; j < data.length; j += 4) {
          const r = data[j];
          const g = data[j + 1];
          const b = data[j + 2];

          const v = 0.299 * r + 0.587 * g + 0.114 * b;
          const val = v > 120 ? 255 : 0; // threshold; you've tuned this already

          data[j] = val;
          data[j + 1] = val;
          data[j + 2] = val;
        }

        ctx.putImageData(imageData, 0, 0);
      } catch (err) {
        console.warn("Could not preprocess image (threshold):", err);
      }

      const dataUrl = canvas.toDataURL("image/png");
      imageUrls.push(dataUrl);

      // Small delay to let the camera update between frames
      if (i < FRAME_SAMPLES - 1) {
        // eslint-disable-next-line no-await-in-loop
        await new Promise((resolve) => setTimeout(resolve, 120));
      }
    }

    // Show the first frame as the preview
    if (imageUrls.length > 0) {
      setImagePreviewUrl(imageUrls[0]);
    }

    setImageFile(null);
    setScanError(null);
    setStatusMessage("");
    setOcrText("");
    setDetectedLanguage(null);

    await runFullScan(imageUrls);
  };

  return (
    <div className="scanner">
      <header className="scanner-header">
        <h1 className="scanner-title">Scan Cards</h1>
        <p className="scanner-subtitle">
          Use your camera or upload a photo of a Pokémon card. I’ll detect the card’s
          language, read the name band multiple times across multiple frames, and
          try to add the correct Pokémon to your collection.
        </p>
      </header>

      {/* Camera section */}
      <section className="scanner-camera">
        <div className="scanner-camera-controls">
          <button
            type="button"
            className="scanner-camera-toggle"
            onClick={() => setCameraActive((prev) => !prev)}
          >
            {cameraActive ? "Stop Camera" : "Start Camera"}
          </button>

          {cameraActive && (
            <button
              type="button"
              className="scanner-scan-btn scanner-scan-btn--camera"
              onClick={handleCaptureAndScan}
              disabled={scanning || !cameraReady}
            >
              {scanning ? "Scanning…" : "Capture & Scan"}
            </button>
          )}
        </div>

        {cameraError && (
          <div className="scanner-error scanner-error--camera">
            {cameraError}
          </div>
        )}

        {cameraActive && (
          <div className="scanner-video-wrapper">
            <video
              ref={videoRef}
              className="scanner-video"
              autoPlay
              playsInline
              muted
            />
            {!cameraReady && (
              <div className="scanner-video-overlay scanner-video-overlay--loading">
                Initializing camera…
              </div>
            )}

            {cameraReady && (
              <>
                {/* Darkened mask + card-shaped frame */}
                <div className="scanner-frame-mask" />
                <div className="scanner-frame" ref={frameRef}>
                  <div className="scanner-frame-border" />
                  <div className="scanner-frame-label">
                    Align the card inside the frame
                  </div>
                </div>
              </>
            )}
          </div>
        )}

        {/* Hidden canvas used for capturing frames */}
        <canvas ref={canvasRef} style={{ display: "none" }} />
      </section>

      {/* File upload section */}
      <section className="scanner-controls">
        <div className="scanner-file-row">
          <label className="scanner-file-label">
            <span>Select a card photo</span>
            <input
              type="file"
              accept="image/*"
              onChange={handleFileChange}
            />
          </label>
        </div>

        {imagePreviewUrl && (
          <div className="scanner-preview">
            <img
              src={imagePreviewUrl}
              alt="Selected card preview"
              className="scanner-preview-image"
            />
          </div>
        )}

        <button
          type="button"
          className="scanner-scan-btn"
          onClick={handleScanClick}
          disabled={(!imageFile && !imagePreviewUrl) || scanning}
        >
          {scanning ? "Scanning…" : "Scan Selected Image"}
        </button>

        {scanError && <div className="scanner-error">{scanError}</div>}
        {statusMessage && (
          <div className="scanner-status">{statusMessage}</div>
        )}

        {detectedLanguage && (
          <div className="scanner-language">
            Detected language:{" "}
            <strong>
              {prettyLanguage(detectedLanguage)} ({detectedLanguage})
            </strong>
          </div>
        )}
      </section>

      {ocrText && (
        <section className="scanner-ocr-debug">
          <h2>Recognized Text (last name-pass)</h2>
          <pre>{ocrText}</pre>
        </section>
      )}
    </div>
  );
}
