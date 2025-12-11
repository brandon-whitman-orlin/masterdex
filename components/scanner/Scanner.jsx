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
// Structure assumed:
// { en: { "bulbasaur": 1, ... }, ja: { "フシギダネ": 1, ... }, ko: {...}, fr: {...}, de: {...} }
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

// Find best Pokémon match in OCR text using a specific language’s name map
function findBestPokemonMatch(rawText, nameMap) {
  if (!rawText || !nameMap) return null;

  const text = rawText.toLowerCase();

  let bestName = null;
  let bestDex = null;
  let bestScore = 0;

  for (const [name, dex] of Object.entries(nameMap)) {
    if (!dex || dex < 1 || dex > MAX_POKEMON) continue;

    const candidate = name.toLowerCase();
    if (!candidate) continue;

    if (text.includes(candidate)) {
      // Longer matches are more specific; use length as score
      const score = candidate.length;
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
        // you can track progress here if desired
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

      const match = findBestPokemonMatch(text, nameMap);
      if (match) {
        matches.push(match);
      }
    }

    if (matches.length === 0) {
      return { match: null, lastText };
    }

    // Majority vote by dexNumber
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

  // --- Full scan pipeline: language vote + name vote + optional Firestore write ---
  async function runFullScan(imageUrl) {
    if (!imageUrl) {
      setScanError("No image to scan.");
      return;
    }

    setScanning(true);
    setScanError(null);
    setStatusMessage("");
    setOcrText("");
    setDetectedLanguage(null);

    try {
      // 1) Language detection (3 runs)
      const langCode = await detectLanguageWithVoting(imageUrl);
      setDetectedLanguage(langCode);

      const langLabel = prettyLanguage(langCode);

      // 2) Name detection with chosen language (3 runs)
      const { match, lastText } = await detectPokemonWithLang(
        imageUrl,
        langCode
      );

      setOcrText(lastText || "");

      if (!match) {
        setStatusMessage(
          `Detected card language as ${langLabel}, but couldn’t confidently read a Pokémon name from the top band.`
        );
        return;
      }

      const { name, dexNumber } = match;
      const formattedName =
        name.charAt(0).toUpperCase() + name.slice(1);

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

  // --- Camera-based capture + scan (crop to CSS frame, then top 20%) ---
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

    // Scale the cropped region to a reasonable size for OCR
    const targetWidth = 800;
    const scale = sWidth > targetWidth ? targetWidth / sWidth : 1;
    const canvasWidth = sWidth * scale;
    const canvasHeight = sHeight * scale;

    canvas.width = canvasWidth;
    canvas.height = canvasHeight;

    const ctx = canvas.getContext("2d");
    if (!ctx) {
      setCameraError("Could not get canvas context.");
      return;
    }

    // Draw only the cropped name band from the video into the canvas
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

    const dataUrl = canvas.toDataURL("image/png");

    setImagePreviewUrl(dataUrl);
    setImageFile(null);
    setScanError(null);
    setStatusMessage("");
    setOcrText("");
    setDetectedLanguage(null);

    await runFullScan(dataUrl);
  };

  return (
    <div className="scanner">
      <header className="scanner-header">
        <h1 className="scanner-title">Scan Cards</h1>
        <p className="scanner-subtitle">
          Use your camera or upload a photo of a Pokémon card. I’ll detect the card’s
          language, read the name band a few times, and try to add the correct
          Pokémon to your collection.
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
