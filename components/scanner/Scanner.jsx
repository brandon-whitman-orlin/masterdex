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

const MAX_POKEMON = 1025;

// Normalized frame for card placement (as percentages of the video)
// These MUST match the CSS overlay values.
const CARD_FRAME = {
  x: 0.1,   // 10% from left
  y: 0.15,  // 15% from top
  width: 0.8,  // 80% width
  height: 0.6, // 60% height
};

// --- Helpers ---

function normalizeText(str) {
  return str
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function textContainsName(text, name) {
  const pattern = new RegExp(`\\b${name}\\b`, "i");
  return pattern.test(text);
}

function approxContains(text, nameCore) {
  if (nameCore.length < 4) return false;
  const prefix = nameCore.slice(0, 4);
  return text.includes(prefix);
}

function formatName(name) {
  if (!name) return "";
  return name.charAt(0).toUpperCase() + name.slice(1);
}

function getSpriteUrl(dexNumber) {
  return `https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/${dexNumber}.png`;
}

export default function Scanner() {
  const { user } = useAuth();

  // File-based scanning state
  const [imageFile, setImageFile] = useState(null);
  const [imagePreviewUrl, setImagePreviewUrl] = useState(null);

  // Pokédex name data
  const [nameToDex, setNameToDex] = useState({});
  const [dexToName, setDexToName] = useState({});
  const [loadingDex, setLoadingDex] = useState(true);
  const [dexError, setDexError] = useState(null);

  // Owned tracking
  const [ownedDex, setOwnedDex] = useState({});

  // Scan state
  const [scanning, setScanning] = useState(false);
  const [ocrText, setOcrText] = useState("");
  const [statusMessage, setStatusMessage] = useState("");
  const [scanError, setScanError] = useState(null);

  // Camera state
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const [cameraActive, setCameraActive] = useState(false);
  const [cameraReady, setCameraReady] = useState(false);
  const [cameraError, setCameraError] = useState(null);

  // --- Load Pokédex data ---
  useEffect(() => {
    async function loadPokedex() {
      try {
        setLoadingDex(true);
        setDexError(null);

        const res = await fetch(
          `https://pokeapi.co/api/v2/pokemon?limit=${MAX_POKEMON}&offset=0`
        );

        if (!res.ok) {
          throw new Error(`HTTP ${res.status}`);
        }

        const data = await res.json();

        const nameMap = {};
        const dexMap = {};

        data.results.forEach((pokemon, index) => {
          const idFromUrl = pokemon.url.split("/").filter(Boolean).pop();
          const id = Number(idFromUrl) || index + 1;

          if (id >= 1 && id <= MAX_POKEMON) {
            const name = pokemon.name.toLowerCase();
            nameMap[name] = id;
            dexMap[id] = pokemon.name;
          }
        });

        setNameToDex(nameMap);
        setDexToName(dexMap);
      } catch (err) {
        console.error("Failed to load Pokédex data for Scanner:", err);
        setDexError("Couldn’t load Pokémon names from PokéAPI.");
      } finally {
        setLoadingDex(false);
      }
    }

    loadPokedex();
  }, []);

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

    const url = URL.createObjectURL(file);
    setImagePreviewUrl(url);
  };

  // --- Core scan logic (shared by file & camera) ---
  const runScanOnImage = async (imageUrl) => {
    if (!imageUrl) {
      setScanError("No image to scan.");
      return;
    }

    if (loadingDex || Object.keys(nameToDex).length === 0) {
      setScanError("Pokédex data isn’t ready yet. Please wait a moment.");
      return;
    }

    setScanning(true);
    setScanError(null);
    setStatusMessage("");
    setOcrText("");

    try {
      const result = await Tesseract.recognize(imageUrl, "eng", {
        logger: () => {
          // optionally show progress
        },
      });

      const rawText = result?.data?.text || "";
      const normalized = normalizeText(rawText);
      setOcrText(rawText);

      if (!normalized) {
        setScanError(
          "No readable text found on this image. Try moving closer or improving lighting."
        );
        return;
      }

      const match = findBestPokemonMatch(normalized, nameToDex);

      if (!match) {
        setStatusMessage("");
        setScanError(
          "I couldn’t confidently detect a Pokémon name on this card. Try adjusting the card or lighting and scan again."
        );
        return;
      }

      const { name, dexNumber } = match;

      if (!user) {
        setStatusMessage(
          `Detected ${formatName(
            name
          )} (#${dexNumber}), but you’re not signed in. Sign in to save it to your collection.`
        );
      } else {
        const alreadyOwned = !!ownedDex[dexNumber];

        await setDoc(
          doc(db, "users", user.uid, "collection", String(dexNumber)),
          {
            dexNumber,
            name: formatName(name),
            addedAt: serverTimestamp(),
          },
          { merge: true }
        );

        if (alreadyOwned) {
          setStatusMessage(
            `Detected ${formatName(name)} (#${dexNumber}). It’s already in your collection.`
          );
        } else {
          setStatusMessage(
            `Added ${formatName(name)} (#${dexNumber}) to your collection!`
          );
        }
      }
    } catch (err) {
      console.error("Failed to scan card:", err);
      setScanError("Something went wrong while scanning this card.");
    } finally {
      setScanning(false);
    }
  };

  // --- File-based scan trigger ---
  const handleScanClick = async () => {
    if (!imageFile && !imagePreviewUrl) {
      setScanError("Please select an image of a card to scan.");
      return;
    }

    if (imagePreviewUrl) {
      await runScanOnImage(imagePreviewUrl);
    } else if (imageFile) {
      const url = URL.createObjectURL(imageFile);
      setImagePreviewUrl(url);
      await runScanOnImage(url);
    }
  };

  // --- Camera-based capture + scan (cropping to frame) ---
  const handleCaptureAndScan = async () => {
    const video = videoRef.current;
    const canvas = canvasRef.current;

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

    if (!video || !canvas) {
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

    // Compute the region (in video coordinates) that corresponds to the overlay frame
    const sx = CARD_FRAME.x * videoWidth;
    const sy = CARD_FRAME.y * videoHeight;
    const sWidth = CARD_FRAME.width * videoWidth;
    const sHeight = CARD_FRAME.height * videoHeight;

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

    // Draw only the cropped region from the video into the canvas
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

    await runScanOnImage(dataUrl);
  };

  // --- Match helper ---
  function findBestPokemonMatch(normalizedText, nameToDexMap) {
    let bestName = null;
    let bestDex = null;
    let bestScore = 0;

    const text = ` ${normalizedText} `;

    for (const [name, dex] of Object.entries(nameToDexMap)) {
      if (dex < 1 || dex > MAX_POKEMON) continue;

      let score = 0;

      if (textContainsName(text, name)) {
        score = 3;
      } else if (text.includes(name)) {
        score = 2;
      } else {
        const nameCore = name.replace(/[^a-z0-9]/g, "");
        if (nameCore.length >= 4 && approxContains(text, nameCore)) {
          score = 1;
        }
      }

      if (score > bestScore) {
        bestScore = score;
        bestName = name;
        bestDex = dex;
      }
    }

    if (!bestName || bestScore === 0) return null;
    return { name: bestName, dexNumber: bestDex, score: bestScore };
  }

  return (
    <div className="scanner">
      <header className="scanner-header">
        <h1 className="scanner-title">Scan Cards</h1>
        <p className="scanner-subtitle">
          Use your camera or upload a photo of a Pokémon card. Line the card
          up inside the frame and I’ll try to detect the Pokémon and add it to
          your collection.
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
              disabled={scanning || loadingDex || !cameraReady}
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
                {/* Darkened mask + card frame */}
                <div className="scanner-frame-mask" />
                <div className="scanner-frame">
                  <div className="scanner-frame-border" />
                  <div className="scanner-frame-label">
                    Align your card inside the frame
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
          disabled={(!imageFile && !imagePreviewUrl) || scanning || loadingDex}
        >
          {scanning ? "Scanning…" : "Scan Selected Image"}
        </button>

        {loadingDex && (
          <div className="scanner-hint">
            Loading Pokédex data from PokéAPI…
          </div>
        )}

        {dexError && <div className="scanner-error">{dexError}</div>}
        {scanError && <div className="scanner-error">{scanError}</div>}
        {statusMessage && (
          <div className="scanner-status">{statusMessage}</div>
        )}
      </section>

      {ocrText && (
        <section className="scanner-ocr-debug">
          <h2>Recognized Text (debug)</h2>
          <pre>{ocrText}</pre>
        </section>
      )}
    </div>
  );
}
