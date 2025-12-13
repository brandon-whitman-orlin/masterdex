// src/components/scanner/Scanner.jsx
import React, { useEffect, useMemo, useState, useRef } from "react";
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

// Cloud Vision function URL (Gen 2 / Cloud Run URL from Firebase Console)
const VISION_ENDPOINT = "https://detectcard-5z4ut44vea-uc.a.run.app";

// Camera capture sampling (keep simple; you can bump later)
const FRAME_SAMPLES = 1;
const CAPTURE_DELAY_MS = 120;

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

// --- Pokemon name helpers (English) ---
function getEnglishNameMap() {
  return pokemonNames?.en || {};
}

// NEW: get English name for a dex number
function getEnglishNameForDex(dexNumber) {
  const enMap = getEnglishNameMap();
  for (const [name, dex] of Object.entries(enMap)) {
    if (dex === dexNumber) {
      return name.charAt(0).toUpperCase() + name.slice(1);
    }
  }
  return null;
}

// --- Cloud Vision helpers ---
function stripDiacritics(s) {
  try {
    return s.normalize("NFKD").replace(/[\u0300-\u036f]/g, "");
  } catch {
    return s;
  }
}

function normalizeEntityText(s) {
  if (!s) return "";
  // keep letters/numbers/spaces/hyphen/apostrophe
  const clean = stripDiacritics(String(s))
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s\-']/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
  return clean;
}

// Try extracting a Pokémon name from longer product strings
function extractCandidateNames(description) {
  const raw = String(description || "");
  const parts = [];

  // Common patterns: "... : Caterpie", "... - Caterpie", "... (Caterpie)", etc.
  const afterColon = raw.split(":").pop();
  if (afterColon && afterColon !== raw) parts.push(afterColon);

  const afterDash = raw.split(" - ").pop();
  if (afterDash && afterDash !== raw) parts.push(afterDash);

  // Parentheses
  const parenMatches = raw.match(/\(([^)]+)\)/g);
  if (parenMatches) {
    parenMatches.forEach((m) => {
      const inner = m.replace(/[()]/g, "");
      parts.push(inner);
    });
  }

  // Also include the whole thing as a fallback
  parts.push(raw);

  // From each part, take first 1-3 tokens as candidates (to avoid set names, etc.)
  const candidates = new Set();
  parts.forEach((p) => {
    const norm = normalizeEntityText(p);
    if (!norm) return;

    const tokens = norm.split(" ").filter(Boolean);
    if (tokens.length === 0) return;

    // "mr mime" edge cases: allow up to 3 tokens
    for (let n = 1; n <= Math.min(3, tokens.length); n++) {
      candidates.add(tokens.slice(0, n).join(" "));
    }

    // also allow last token (often just the name)
    candidates.add(tokens[tokens.length - 1]);
  });

  return Array.from(candidates).filter(Boolean);
}

function buildEnglishNameLookup() {
  const enMap = getEnglishNameMap(); // { name -> dex }
  const lookup = new Map(); // normalizedName -> { name, dexNumber }

  Object.entries(enMap).forEach(([name, dex]) => {
    if (!dex || dex < 1 || dex > MAX_POKEMON) return;
    const key = normalizeEntityText(name);
    if (!key) return;
    lookup.set(key, { name, dexNumber: dex });
  });

  return lookup;
}

function pickBestPokemonFromVision(webEntities, englishLookup) {
  if (!Array.isArray(webEntities) || webEntities.length === 0) return null;

  // Highest score first
  const sorted = [...webEntities].sort(
    (a, b) => (b.score || 0) - (a.score || 0)
  );

  for (const e of sorted) {
    const desc = e?.description;
    if (!desc) continue;

    const candidates = extractCandidateNames(desc);
    for (const c of candidates) {
      const hit = englishLookup.get(normalizeEntityText(c));
      if (hit) {
        const formattedName =
          hit.name.charAt(0).toUpperCase() + hit.name.slice(1);

        return {
          name: formattedName,
          dexNumber: hit.dexNumber,
          score: typeof e.score === "number" ? e.score : null,
          rawDescription: desc,
        };
      }
    }
  }

  return null;
}

async function callVisionEndpoint(imageDataUrl, user) {
  if (!user) throw new Error("Not signed in.");

  const token = await user.getIdToken();

  const res = await fetch(VISION_ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ imageBase64: imageDataUrl }),
  });

  const json = await res.json().catch(() => ({}));

  if (!res.ok) {
    const msg =
      json?.error ||
      json?.message ||
      `Vision request failed with HTTP ${res.status}`;
    throw new Error(
      typeof json === "object"
        ? `${msg}\n${JSON.stringify(json, null, 2)}`
        : msg
    );
  }

  return json;
}

// --- Component ---
export default function Scanner() {
  const { user } = useAuth();

  const englishLookup = useMemo(() => buildEnglishNameLookup(), []);

  const [imageFile, setImageFile] = useState(null);
  const [imagePreviewUrl, setImagePreviewUrl] = useState(null);

  const [ownedDex, setOwnedDex] = useState({});

  const [scanning, setScanning] = useState(false);
  const [detectedLanguage, setDetectedLanguage] = useState(null); // kept for CSS structure; now "vision"
  const [statusMessage, setStatusMessage] = useState("");
  const [scanError, setScanError] = useState(null);
  const [ocrText, setOcrText] = useState(""); // kept for CSS/debug structure; now holds raw vision debug if you want

  // confirmation & placement state
  const [pendingMatch, setPendingMatch] = useState(null);
  // pendingMatch: { dexNumber, name, langCode, alreadyOwned, score, rawDescription }
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

  const resetScanUI = () => {
    setScanError(null);
    setStatusMessage("");
    setOcrText("");
    setDetectedLanguage(null);
    setPendingMatch(null);
    setPlacementInfo(null);
  };

  // --- File selection ---
  const handleFileChange = async (e) => {
    const file = e.target.files && e.target.files[0];
    if (!file) return;

    setImageFile(file);
    resetScanUI();

    const url = URL.createObjectURL(file);
    setImagePreviewUrl(url);

    // allow same file again
    e.target.value = "";
  };

  // --- Full scan pipeline (Vision) ---
  async function runFullScan(imageInput) {
    const imageUrls = Array.isArray(imageInput) ? imageInput : [imageInput];
    if (!imageUrls.length) {
      setScanError("No image to scan.");
      return;
    }

    setScanning(true);
    resetScanUI();

    try {
      // If not signed in, we can still show the preview but we can't call the function
      if (!user) {
        setScanError("Sign in to scan cards with Cloud Vision.");
        return;
      }

      // For now: just use the first frame (you can vote across multiple later)
      const imageUrl = imageUrls[0];

      setDetectedLanguage("vision"); // reusing this block to show the “source”

      const visionJson = await callVisionEndpoint(imageUrl, user);
      const webEntities = visionJson?.webEntities || [];

      // (Optional) keep debug text in this old field to preserve debug section CSS
      setOcrText(JSON.stringify({ webEntities }, null, 2));

      const match = pickBestPokemonFromVision(webEntities, englishLookup);

      if (!match) {
        setStatusMessage(
          `I couldn't confidently identify a Pokémon from this image. Try a clearer photo (less glare / more centered).`
        );
        return;
      }

      const { name, dexNumber, score, rawDescription } = match;
      const alreadyOwned = !!ownedDex[dexNumber];

      // Status message (bold span)
      setStatusMessage(
        `Detected <span class="bold">${name} (#${dexNumber})</span> via CardVision<br/>Please confirm below:`
      );

      setPendingMatch({
        dexNumber,
        name,
        langCode: "vision",
        alreadyOwned,
        score: typeof score === "number" ? score : null,
        rawDescription: rawDescription || null,
      });
    } catch (err) {
      console.error("Failed to scan card (CloudVision):", err);
      setScanError("Something went wrong while scanning this card.");
      setStatusMessage(err?.message ? String(err.message) : "");
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
      return;
    }

    // fallback
    if (imageFile) {
      const url = URL.createObjectURL(imageFile);
      setImagePreviewUrl(url);
      await runFullScan(url);
    }
  };

  // --- Camera-based capture + scan ---
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

    const ctx = canvas.getContext("2d");
    if (!ctx) {
      setCameraError("Could not get canvas context.");
      return;
    }

    const videoRect = video.getBoundingClientRect();
    const frameRect = frame.getBoundingClientRect();

    const scaleX = videoWidth / videoRect.width;
    const scaleY = videoHeight / videoRect.height;

    // Crop to the visible frame area (still useful), but we DO NOT crop the “top band” anymore.
    const sx = (frameRect.left - videoRect.left) * scaleX;
    const sy = (frameRect.top - videoRect.top) * scaleY;
    const sWidth = frameRect.width * scaleX;
    const sHeight = frameRect.height * scaleY;

    const imageUrls = [];

    for (let i = 0; i < FRAME_SAMPLES; i++) {
      // Downscale to keep payload reasonable but still readable
      const targetWidth = 1100;
      const scale = sWidth > targetWidth ? targetWidth / sWidth : 1;

      const canvasWidth = Math.max(1, Math.round(sWidth * scale));
      const canvasHeight = Math.max(1, Math.round(sHeight * scale));

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

      const dataUrl = canvas.toDataURL("image/jpeg", 0.92);
      imageUrls.push(dataUrl);

      if (i < FRAME_SAMPLES - 1) {
        // eslint-disable-next-line no-await-in-loop
        await new Promise((resolve) => setTimeout(resolve, CAPTURE_DELAY_MS));
      }
    }

    if (imageUrls.length > 0) {
      setImagePreviewUrl(imageUrls[0]);
    }

    setImageFile(null);
    resetScanUI();

    await runFullScan(imageUrls);
  };

  // --- Confirmation flow ---
  const handleRejectMatch = () => {
    setPendingMatch(null);
    setPlacementInfo(null);
    setStatusMessage(
      "Darn - try scanning again or adjust the card in the frame."
    );
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
          source: "cloud-vision",
          visionScore: pendingMatch.score ?? null,
          addedAt: serverTimestamp(),
        },
        { merge: true }
      );

      const slot = placementInfo || findSlot(pendingMatch.dexNumber) || null;

      if (slot && !slot.error) {
        setStatusMessage(
          `Added ${pendingMatch.name} (#${pendingMatch.dexNumber}) to your collection.<br/>Binder ${slot.binder}, Page ${slot.page}, Slot ${slot.slotOnPage} (slot ${slot.slotInBinder} in that binder).`
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

  // English name (Vision returns English already, but keep structure)
  const englishName =
    pendingMatch && pendingMatch.dexNumber
      ? getEnglishNameForDex(pendingMatch.dexNumber)
      : null;

  return (
    <div className="scanner">
      <header className="scanner-header">
        <h1 className="scanner-title">Scan Cards</h1>
        <p className="scanner-subtitle">
          Use your camera or upload a photo of a Pokémon card. CardVision will
          guess the Pokémon, you confirm it, then we’ll show binder placement
          and let you add it.
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

                <div className="scanner-frame" ref={frameRef}>
                  <div className="scanner-frame-border" />
                  <div className="scanner-frame-label">
                    Align the card inside the frame
                  </div>

                  {/* Button INSIDE frame (make sure your .scanner-frame allows pointer-events) */}
                  <button
                    type="button"
                    className="scanner-scan-btn scanner-scan-btn--camera"
                    onClick={handleCaptureAndScan}
                    disabled={scanning}
                    style={{ pointerEvents: "auto" }}
                  >
                    {scanning ? <Loading /> : <Camera />}
                  </button>
                </div>
              </>
            )}
          </div>
        )}

        <canvas ref={canvasRef} style={{ display: "none" }} />
      </section>

      {/* File upload section */}
      <section className="scanner-controls">
        {/* <div className="scanner-file-row">
          <label className="scanner-file-label">
            <span>Select a card photo</span>
            <input type="file" accept="image/*" onChange={handleFileChange} />
          </label>
        </div> */}

        {imagePreviewUrl && (
          <div className="scanner-preview">
            <img
              src={imagePreviewUrl}
              alt="Selected card preview"
              className="scanner-preview-image"
            />
          </div>
        )}

        {/* <button
          type="button"
          className="scanner-scan-btn"
          onClick={handleScanClick}
          disabled={(!imageFile && !imagePreviewUrl) || scanning || !user}
          title={!user ? "Sign in to scan with Cloud Vision" : "Scan selected image"}
        >
          {scanning ? "Scanning…" : "Scan Selected Image"}
        </button> */}

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
              {/* Source: <strong>CardVision</strong> */}
              {pendingMatch?.score != null && (
                <>
                  Confidence: <strong>{pendingMatch.score.toFixed(3)}</strong>
                </>
              )}
            </p>

            {pendingMatch?.dexNumber && (
              <img
                className="scanner-language-sprite"
                src={`https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/${pendingMatch.dexNumber}.png`}
                alt={`Pokémon #${pendingMatch.dexNumber} sprite`}
              />
            )}
          </div>
        )}
      </section>

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
                {englishName && englishName !== pendingMatch.name && (
                  <>
                    {" "}
                    — {englishName} <span>#{pendingMatch.dexNumber}</span>
                  </>
                )}
              </div>

              {/* <div className="scanner-confirm-lang">
                Source: <span className="bold">Cloud Vision</span>
                {pendingMatch.score != null && (
                  <>
                    {" "}
                    • <span className="bold">{pendingMatch.score.toFixed(3)}</span>
                  </>
                )}
              </div> */}

              {pendingMatch.rawDescription && (
                <div className="scanner-confirm-owned-note">
                  {/* Matched from: “{pendingMatch.rawDescription}” */}
                </div>
              )}

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
                {pendingMatch.name} (# {pendingMatch.dexNumber}) goes:
              </strong>{" "}
            </p>
            <ul>
              <li>
                Binder: <strong>{placementInfo.binder}</strong>
              </li>
              <li>
                Page: <strong>{placementInfo.page}</strong>
              </li>
              <li>
                Slot on page: <strong>{placementInfo.slotOnPage}</strong>
              </li>
              <li>
                Slot within binder:{" "}
                <strong>{placementInfo.slotInBinder}</strong>
              </li>
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

      {/* Debug section (kept to preserve CSS & easy debugging) */}
      {ocrText && (
        <section className="scanner-ocr-debug">
          <h2>Vision Debug (webEntities)</h2>
          <pre>{ocrText}</pre>
        </section>
      )}
    </div>
  );
}
