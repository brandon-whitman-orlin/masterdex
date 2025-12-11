// src/components/scanner/Scanner.jsx
import React, { useEffect, useState, useRef } from "react";
import Tesseract from "tesseract.js";
import "./Scanner.css";

import { ReactComponent as Loading } from "../../assets/icons/loading.svg";
import { ReactComponent as Camera } from "../../assets/icons/camera.svg";

import { useAuth } from "../../src/AuthContext";
import { db } from "../../src/firebase";
import {
  doc,
  setDoc,
  serverTimestamp,
  collection,
  onSnapshot,
} from "firebase/firestore";

import pokemonNames from "../../src/pokemon-names.json";

const MAX_POKEMON = 1025;

// --- Binder layout config (match your Calculator logic) ---
const SLOTS_PER_BINDER = 360; // 40 pages × 9 slots
const SLOTS_PER_PAGE = 9;

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

const NAME_BAND_RATIO = 0.2; // top 20% of the card
const FRAME_SAMPLES = 3; // number of distinct frames to capture from camera

// --- Helper: slot math (binder/page/slot) ---
function findSlot(pokedexNumber) {
  if (
    !Number.isInteger(pokedexNumber) ||
    pokedexNumber < 1 ||
    pokedexNumber > MAX_POKEMON
  ) {
    return { error: `Pokédex number must be between 1 and ${MAX_POKEMON}.` };
  }

  const zeroBasedIndex = pokedexNumber - 1;

  const binderIndex = Math.floor(zeroBasedIndex / SLOTS_PER_BINDER);
  const binder = binderIndex + 1;

  const positionInBinder = zeroBasedIndex % SLOTS_PER_BINDER;
  const slotInBinder = positionInBinder + 1;

  const pageIndex = Math.floor(positionInBinder / SLOTS_PER_PAGE);
  const page = pageIndex + 1;

  const slotOnPage = (positionInBinder % SLOTS_PER_PAGE) + 1;

  return {
    binder,
    page,
    slotOnPage,
    slotInBinder,
  };
}

// --- OCR helpers + fuzzy matching ---

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

    if (code >= 0x3040 && code <= 0x309f) {
      // Hiragana
      hasHiraganaOrKatakana = true;
      continue;
    }
    if (code >= 0x30a0 && code <= 0x30ff) {
      // Katakana
      hasHiraganaOrKatakana = true;
      continue;
    }
    if (code >= 0xac00 && code <= 0xd7af) {
      // Hangul
      hasHangul = true;
      continue;
    }

    if (frChars.includes(ch)) hasFrAccent = true;
    if (deChars.includes(ch)) hasDeAccent = true;
  }

  if (hasHangul) return "ko";
  if (hasHiraganaOrKatakana) return "ja";
  if (hasFrAccent) return "fr";
  if (hasDeAccent) return "de";

  return "en";
}

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

function getNameMapForLang(langCode) {
  const map = pokemonNames[langCode];
  if (map && Object.keys(map).length > 0) return map;
  return pokemonNames.en || {};
}

// NEW: get English name for a dex number
function getEnglishNameForDex(dexNumber) {
  const enMap = pokemonNames.en || {};
  for (const [name, dex] of Object.entries(enMap)) {
    if (dex === dexNumber) {
      return name.charAt(0).toUpperCase() + name.slice(1);
    }
  }
  return null;
}

function normalizeForMatching(text, langCode) {
  if (!text) return "";

  if (langCode === "ja" || langCode === "ko") {
    return text.replace(/\s+/g, "");
  }

  return text.toLowerCase().replace(/\s+/g, " ").trim();
}

function levenshtein(a, b) {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;

  const dp = Array.from({ length: a.length + 1 }, () =>
    new Array(b.length + 1).fill(0)
  );

  for (let i = 0; i <= a.length; i++) dp[i][0] = i;
  for (let j = 0; j <= b.length; j++) dp[0][j] = j;

  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(
        dp[i - 1][j] + 1,
        dp[i][j - 1] + 1,
        dp[i - 1][j - 1] + cost
      );
    }
  }

  return dp[a.length][b.length];
}

function bestSubstringDistance(textNorm, candidateNorm) {
  if (!textNorm || !candidateNorm) return Infinity;

  const tLen = textNorm.length;
  const cLen = candidateNorm.length;

  if (cLen === 0) return Infinity;
  if (tLen === 0) return Infinity;

  if (cLen >= tLen) {
    return levenshtein(candidateNorm, textNorm);
  }

  let minDist = Infinity;
  for (let i = 0; i <= tLen - cLen; i++) {
    const sub = textNorm.slice(i, i + cLen);
    const d = levenshtein(candidateNorm, sub);
    if (d < minDist) {
      minDist = d;
      if (minDist === 0) break;
    }
  }

  return minDist;
}

function findBestPokemonMatch(rawText, nameMap, langCode) {
  if (!rawText || !nameMap) return null;

  const textNorm = normalizeForMatching(rawText, langCode);

  let bestName = null;
  let bestDex = null;
  let bestScore = 0;

  for (const [name, dex] of Object.entries(nameMap)) {
    if (!dex || dex < 1 || dex > MAX_POKEMON) continue;

    const candidateNorm = normalizeForMatching(name, langCode);
    if (!candidateNorm) continue;

    // Exact substring match
    if (textNorm.includes(candidateNorm)) {
      const score = candidateNorm.length + 100;
      if (score > bestScore) {
        bestScore = score;
        bestName = name;
        bestDex = dex;
      }
      continue;
    }

    const dist = bestSubstringDistance(textNorm, candidateNorm);
    if (!Number.isFinite(dist)) continue;

    const maxAllowed =
      candidateNorm.length <= 3 ? 1 : candidateNorm.length <= 6 ? 2 : 2;

    if (dist <= maxAllowed) {
      const score = candidateNorm.length - dist * 1.5;
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

// --- Component ---

export default function Scanner() {
  const { user } = useAuth();

  const [imageFile, setImageFile] = useState(null);
  const [imagePreviewUrl, setImagePreviewUrl] = useState(null);

  const [ownedDex, setOwnedDex] = useState({});

  const [scanning, setScanning] = useState(false);
  const [detectedLanguage, setDetectedLanguage] = useState(null);
  const [statusMessage, setStatusMessage] = useState("");
  const [scanError, setScanError] = useState(null);
  const [ocrText, setOcrText] = useState("");

  // confirmation & placement state
  const [pendingMatch, setPendingMatch] = useState(null);
  // pendingMatch: { dexNumber, name, langCode, alreadyOwned }
  const [placementInfo, setPlacementInfo] = useState(null);
  const [savingMatch, setSavingMatch] = useState(false);

  // Camera state
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const frameRef = useRef(null);

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
          const dex = data.dexNumber ?? Number.parseInt(docSnap.id, 10) ?? null;
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

  // --- Camera start/stop ---
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

  useEffect(() => {
    if (cameraActive) {
      startCameraStream();
    } else {
      stopCameraStream();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cameraActive]);

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
    setPendingMatch(null);
    setPlacementInfo(null);

    const url = URL.createObjectURL(file);
    setImagePreviewUrl(url);
  };

  // --- OCR wrappers ---

  async function ocrOnce(imageUrl, langs) {
    const result = await Tesseract.recognize(imageUrl, langs, {
      logger: () => {},
    });
    return result?.data?.text || "";
  }

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

  async function detectPokemonWithLang(imageUrl, langCode) {
    const tesseractLang = LANG_CODE_TO_TESSERACT[langCode] || "eng";
    const nameMap = getNameMapForLang(langCode);

    const matches = [];
    let lastText = "";

    for (let i = 0; i < 3; i++) {
      const text = await ocrOnce(imageUrl, tesseractLang);
      lastText = text || lastText;

      const match = findBestPokemonMatch(text, nameMap, langCode);
      if (match) matches.push(match);
    }

    if (matches.length === 0) {
      return { match: null, lastText };
    }

    // Majority vote within one image
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

    const chosen = matches.find((m) => m.dexNumber === bestDex);
    return { match: chosen || null, lastText };
  }

  // --- Full scan pipeline (now sets pendingMatch instead of writing immediately) ---
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
    setPendingMatch(null);
    setPlacementInfo(null);

    try {
      // 1) Language detection across frames
      const frameLangs = [];
      for (const url of imageUrls) {
        const langForFrame = await detectLanguageWithVoting(url);
        frameLangs.push(langForFrame);
      }
      const langCode = majorityVote(frameLangs) || "en";
      setDetectedLanguage(langCode);
      const langLabel = prettyLanguage(langCode);

      // 2) Name detection across frames
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
          `Detected card language as ${langLabel}, but couldn't confidently read a Pokémon name from the top band.`
        );
        return;
      }

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
          `Detected card language as ${langLabel}, but couldn't confidently agree on which Pokémon it is.`
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

      const alreadyOwned = !!ownedDex[dexNumber];

      // If user not signed in, we still show the guess but can't add
      if (!user) {
        setPendingMatch({
          dexNumber,
          name: formattedName,
          langCode,
          alreadyOwned: false,
        });
        setStatusMessage(
          `Detected <span class="bold">${formattedName} (#${dexNumber})</span> on a ${langLabel} card. Sign in to add it to your collection.`
        );
        return;
      }

      // User is signed in → ask them to confirm, then optionally add
      setPendingMatch({
        dexNumber,
        name: formattedName,
        langCode,
        alreadyOwned,
      });

      setStatusMessage(
        `Detected <span class="bold">${formattedName} (#${dexNumber})</span> on a ${langLabel} card. Please confirm below.`
      );
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

  // --- Camera-based capture + scan (multi-frame) ---
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

    const videoRect = video.getBoundingClientRect();
    const frameRect = frame.getBoundingClientRect();

    const scaleX = videoWidth / videoRect.width;
    const scaleY = videoHeight / videoRect.height;

    const frameSx = (frameRect.left - videoRect.left) * scaleX;
    const frameSy = (frameRect.top - videoRect.top) * scaleY;
    const frameWidth = frameRect.width * scaleX;
    const frameHeight = frameRect.height * scaleY;

    const sx = frameSx;
    const sy = frameSy;
    const sWidth = frameWidth;
    const sHeight = frameHeight * NAME_BAND_RATIO;

    const ctx = canvas.getContext("2d");
    if (!ctx) {
      setCameraError("Could not get canvas context.");
      return;
    }

    const imageUrls = [];

    for (let i = 0; i < FRAME_SAMPLES; i++) {
      const targetWidth = 800;
      const scale = sWidth > targetWidth ? targetWidth / sWidth : 1;
      const canvasWidth = sWidth * scale;
      const canvasHeight = sHeight * scale;

      canvas.width = canvasWidth;
      canvas.height = canvasHeight;

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

      try {
        const imageData = ctx.getImageData(0, 0, canvasWidth, canvasHeight);
        const data = imageData.data;

        for (let j = 0; j < data.length; j += 4) {
          const r = data[j];
          const g = data[j + 1];
          const b = data[j + 2];

          const v = 0.299 * r + 0.587 * g + 0.114 * b;
          const val = v > 115 ? 255 : 0; // your tuned threshold

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

      if (i < FRAME_SAMPLES - 1) {
        // eslint-disable-next-line no-await-in-loop
        await new Promise((resolve) => setTimeout(resolve, 120));
      }
    }

    if (imageUrls.length > 0) {
      setImagePreviewUrl(imageUrls[0]);
    }

    setImageFile(null);
    setScanError(null);
    setStatusMessage("");
    setOcrText("");
    setDetectedLanguage(null);
    setPendingMatch(null);
    setPlacementInfo(null);

    await runFullScan(imageUrls);
  };

  // --- Confirmation flow ---

  const handleRejectMatch = () => {
    setPendingMatch(null);
    setPlacementInfo(null);
    setStatusMessage("Okay, let's try scanning again or adjust the card.");
  };

  const handleConfirmMatch = () => {
    if (!pendingMatch) return;
    const slot = findSlot(pendingMatch.dexNumber);
    if (slot.error) {
      setPlacementInfo(null);
      setStatusMessage(slot.error);
      return;
    }
    setPlacementInfo(slot);
    setStatusMessage(
      `Great! Here's where <span class="bold">${pendingMatch.name}</span> goes in your binders.`
    );
  };

  const handleAddConfirmedToCollection = async () => {
    if (!user || !pendingMatch) return;

    try {
      setSavingMatch(true);

      const ref = doc(
        db,
        "users",
        user.uid,
        "collection",
        String(pendingMatch.dexNumber)
      );

      await setDoc(
        ref,
        {
          dexNumber: pendingMatch.dexNumber,
          name: pendingMatch.name,
          language: pendingMatch.langCode,
          addedAt: serverTimestamp(),
        },
        { merge: true }
      );

      const slot = placementInfo || findSlot(pendingMatch.dexNumber) || null;

      if (slot && !slot.error) {
        setStatusMessage(
          `Added ${pendingMatch.name} (#${pendingMatch.dexNumber}) to your collection.\nBinder ${slot.binder}, Page ${slot.page}, Slot ${slot.slotOnPage} (slot ${slot.slotInBinder} in that binder).`
        );
      } else {
        setStatusMessage(
          `Added ${pendingMatch.name} (#${pendingMatch.dexNumber}) to your collection.`
        );
      }

      setPendingMatch(null);
      setPlacementInfo(null);
    } catch (err) {
      console.error("Failed to save confirmed match:", err);
      setStatusMessage("Could not save this Pokémon to your collection.");
    } finally {
      setSavingMatch(false);
    }
  };

  // Compute English name for confirmation UI
  const englishName =
    pendingMatch && pendingMatch.dexNumber
      ? getEnglishNameForDex(pendingMatch.dexNumber)
      : null;

  return (
    <div className="scanner">
      <header className="scanner-header">
        <h1 className="scanner-title">Scan Cards</h1>
        <p className="scanner-subtitle">
          Use your camera or upload a photo of a Pokémon card. I'll detect the
          card's language, guess the Pokémon, let you confirm it, and then help
          you place it in your binders.
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
                <div className="scanner-frame-mask" />
                {/* Capture & Scan button moved INSIDE the frame */}
                <button
                  type="button"
                  className="scanner-scan-btn scanner-scan-btn--camera"
                  onClick={handleCaptureAndScan}
                  disabled={scanning}
                >
                  {scanning ? <Loading /> : <Camera />}
                </button>
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

        <canvas ref={canvasRef} style={{ display: "none" }} />
      </section>

      {/* File upload section */}

      {cameraReady && (
        <section className="scanner-controls">
          <h3>Captured image:</h3>
          {/*
        <div className="scanner-file-row">
          <label className="scanner-file-label">
            <span>Select a card photo</span>
            <input type="file" accept="image/*" onChange={handleFileChange} />
          </label>
        </div>
        */}

          {imagePreviewUrl && (
            <div className="scanner-preview">
              <img
                src={imagePreviewUrl}
                alt="Selected card preview"
                className="scanner-preview-image"
              />
            </div>
          )}

          {scanError && <div className="scanner-error">{scanError}</div>}
          {statusMessage && (
            <p
              className="scanner-status"
              dangerouslySetInnerHTML={{ __html: statusMessage }}
            />
          )}

          {detectedLanguage && (
            <div className="scanner-language">
              <p>
                Detected language:{" "}
                <strong>
                  {prettyLanguage(detectedLanguage)} ({detectedLanguage})
                </strong>
              </p>
            </div>
          )}
        </section>
      )}

      {/* Confirmation + placement UI */}
      {pendingMatch && (
        <section className="scanner-confirm">
          <h2>Did I get this right?</h2>
          <div className="scanner-confirm-card">
            <div className="scanner-confirm-main">
              <div className="scanner-confirm-name">
                <span className="bold">
                  {pendingMatch.name} <span>#{pendingMatch.dexNumber}</span>
                </span>
                {englishName && (
                  <>
                    {" "}
                    : {englishName} <span>#{pendingMatch.dexNumber}</span>
                  </>
                )}
              </div>
              <div className="scanner-confirm-lang">
                Language:
                <span className="bold">
                  {prettyLanguage(pendingMatch.langCode)} (
                  {pendingMatch.langCode})
                </span>
              </div>
              {pendingMatch.alreadyOwned && (
                <div className="scanner-confirm-owned-note">
                  This Pokémon is already in your collection.
                </div>
              )}
            </div>

            <div className="scanner-confirm-actions">
              <button
                type="button"
                className="scanner-confirm-btn scanner-confirm-btn--yes"
                onClick={handleConfirmMatch}
              >
                Yes
              </button>
              <button
                type="button"
                className="scanner-confirm-btn scanner-confirm-btn--no"
                onClick={handleRejectMatch}
              >
                No
              </button>
            </div>
          </div>
        </section>
      )}

      {pendingMatch && placementInfo && (
        <section className="scanner-placement">
          <h2>Binder placement</h2>
          <div className="scanner-placement-details">
            <p>
              <strong>
                {pendingMatch.name} (# {pendingMatch.dexNumber})
              </strong>{" "}
              goes here:
            </p>
            <ul>
              <li>Binder: {placementInfo.binder}</li>
              <li>Page: {placementInfo.page}</li>
              <li>Slot on page: {placementInfo.slotOnPage}</li>
              <li>Slot within binder: {placementInfo.slotInBinder}</li>
            </ul>
          </div>

          {user ? (
            <button
              type="button"
              className="scanner-scan-btn scanner-scan-btn--confirm-add"
              onClick={handleAddConfirmedToCollection}
              disabled={savingMatch}
            >
              {savingMatch
                ? "Saving…"
                : pendingMatch.alreadyOwned
                ? "Update / Confirm in My Collection"
                : "Add to My Collection"}
            </button>
          ) : (
            <div className="scanner-error">
              Sign in to save this Pokémon to your collection.
            </div>
          )}
        </section>
      )}

      {ocrText && (
        <section className="scanner-ocr-debug">
          <h2>Recognized Text (last name-pass)</h2>
          <pre>{ocrText}</pre>
        </section>
      )}
    </div>
  );
}
