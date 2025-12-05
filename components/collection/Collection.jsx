// src/components/Collection/Collection.jsx
import React, { useEffect, useState, useRef } from "react";
import "./Collection.css";

import { useAuth } from "../../src/AuthContext";
import { db } from "../../src/firebase";
import {
  collection,
  onSnapshot,
  doc,
  setDoc,
  deleteDoc,
  serverTimestamp,
} from "firebase/firestore";

const MAX_POKEMON = 1025;

const GENERATIONS = [
  { label: "Generation 1", start: 1, end: 151 },
  { label: "Generation 2", start: 152, end: 251 },
  { label: "Generation 3", start: 252, end: 386 },
  { label: "Generation 4", start: 387, end: 493 },
  { label: "Generation 5", start: 494, end: 649 },
  { label: "Generation 6", start: 650, end: 721 },
  { label: "Generation 7", start: 722, end: 809 },
  { label: "Generation 8", start: 810, end: 905 },
  { label: "Generation 9", start: 906, end: 1025 },
];

// Helper: sprite URL from dex number (no extra API calls)
function getSpriteUrl(dexNumber) {
  return `https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/${dexNumber}.png`;
}

// Helper: get sorted list of owned dex numbers
function getOwnedDexList(ownedDex) {
  return Object.keys(ownedDex)
    .map((k) => Number(k))
    .filter((n) => Number.isFinite(n) && n >= 1 && n <= MAX_POKEMON)
    .sort((a, b) => a - b);
}

// Helper: trigger download of a blob
function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

// Parse CSV text into a list of dex numbers
function parseCsvOwned(text) {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);

  if (lines.length === 0) return [];

  // find the first non-comment line
  const dataLine = lines.find((line) => !line.startsWith("#")) || "";

  if (!dataLine) return [];

  return dataLine
    .split(",")
    .map((chunk) => Number(chunk.trim()))
    .filter((n) => Number.isInteger(n) && n >= 1 && n <= MAX_POKEMON);
}

// Parse JSON text into a list of dex numbers
function parseJsonOwned(text) {
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    return [];
  }

  if (!parsed || !Array.isArray(parsed.owned)) {
    return [];
  }

  return parsed.owned
    .map((n) => Number(n))
    .filter((n) => Number.isInteger(n) && n >= 1 && n <= MAX_POKEMON);
}

// Decide parser based on filename + content
function parseOwnedFromFile(text, fileName) {
  const lowerName = (fileName || "").toLowerCase();

  if (lowerName.endsWith(".json")) {
    return parseJsonOwned(text);
  }
  if (lowerName.endsWith(".csv")) {
    return parseCsvOwned(text);
  }

  // fallback: try JSON first, then CSV
  const fromJson = parseJsonOwned(text);
  if (fromJson.length > 0) return fromJson;
  return parseCsvOwned(text);
}

export function Collection() {
  const { user } = useAuth();

  // ownedDex: { [dexNumber]: true }
  const [ownedDex, setOwnedDex] = useState({});
  const ownedCount = Object.keys(ownedDex).length;
  const completion = (ownedCount / MAX_POKEMON) * 100;

  const [updatingDex, setUpdatingDex] = useState(null); // which tile is being written, if any

  // filters
  const [showOwned, setShowOwned] = useState(true);
  const [showUnowned, setShowUnowned] = useState(true);

  // export UI toggle
  const [showExportOptions, setShowExportOptions] = useState(false);

  // import file input ref
  const importInputRef = useRef(null);

  // import status message
  const [importMessage, setImportMessage] = useState("");

  // Subscribe to this user's collection in Firestore
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
        console.error("Failed to read collection:", error);
        setOwnedDex({});
      }
    );

    return () => unsubscribe();
  }, [user]);

  // Toggle a Pokémon in the collection
  const handleTileClick = async (dexNumber, isOwned) => {
    if (!user) {
      return;
    }

    try {
      setUpdatingDex(dexNumber);

      const ref = doc(db, "users", user.uid, "collection", String(dexNumber));

      if (isOwned) {
        // Remove from collection
        await deleteDoc(ref);
      } else {
        // Add to collection
        await setDoc(
          ref,
          {
            dexNumber,
            addedAt: serverTimestamp(),
          },
          { merge: true }
        );
      }
    } catch (err) {
      console.error("Failed to toggle collection:", err);
    } finally {
      setUpdatingDex(null);
    }
  };

  // Export handler: generate CSV/JSON and download, then hide options
  const handleExportFormatSelect = (format) => {
    // Hide previous import status
    setImportMessage("");

    const ownedList = getOwnedDexList(ownedDex);

    if (format === "csv") {
      const header = "#owned";
      const line = ownedList.join(",");
      const csv = `${header}\n${line}\n`;
      const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
      downloadBlob(blob, "pokedexset-collection.csv");
    } else if (format === "json") {
      const payload = { owned: ownedList };
      const json = JSON.stringify(payload, null, 2);
      const blob = new Blob([json], {
        type: "application/json;charset=utf-8;",
      });
      downloadBlob(blob, "pokedexset-collection.json");
    }

    // hide export dropdown
    setShowExportOptions(false);
  };

  // Import: trigger hidden file input
  const handleImportClick = () => {
    // Hide export options
    setShowExportOptions(false);

    // Clear previous import status
    setImportMessage("");

    if (importInputRef.current) {
      importInputRef.current.click();
    }
  };

  // Import: handle chosen file -> parse -> apply to Firestore
  const handleImportFileChange = async (event) => {
    const file = event.target.files && event.target.files[0];
    if (!file) return;

    // clear value so selecting the same file again still triggers change
    event.target.value = "";

    if (!user) {
      setImportMessage("You must be signed in to import a collection.");
      return;
    }

    try {
      setShowExportOptions(false);
      setImportMessage("Importing collection…");

      const text = await file.text();
      const importedOwnedList = parseOwnedFromFile(text, file.name);

      if (!importedOwnedList || importedOwnedList.length === 0) {
        setImportMessage("No valid Pokémon found in the import file.");
        return;
      }

      const newOwnedSet = new Set(importedOwnedList);
      const currentOwnedList = getOwnedDexList(ownedDex);
      const currentOwnedSet = new Set(currentOwnedList);

      const toAdd = [];
      const toRemove = [];

      // which new ones to add
      for (const dex of newOwnedSet) {
        if (!currentOwnedSet.has(dex)) {
          toAdd.push(dex);
        }
      }

      // which existing ones to remove
      for (const dex of currentOwnedSet) {
        if (!newOwnedSet.has(dex)) {
          toRemove.push(dex);
        }
      }

      // Optional: confirm destructive changes
      const totalChanges = toAdd.length + toRemove.length;
      const confirmed =
        totalChanges === 0 ||
        window.confirm(
          `Import will set your collection to ${importedOwnedList.length} owned Pokémon.\n` +
            `Add: ${toAdd.length}, Remove: ${toRemove.length}.\n\nContinue?`
        );

      if (!confirmed) {
        setImportMessage("Import cancelled.");
        return;
      }

      const userPath = ["users", user.uid, "collection"];

      const addPromises = toAdd.map((dex) =>
        setDoc(
          doc(db, ...userPath, String(dex)),
          {
            dexNumber: dex,
            addedAt: serverTimestamp(),
          },
          { merge: true }
        )
      );

      const removePromises = toRemove.map((dex) =>
        deleteDoc(doc(db, ...userPath, String(dex)))
      );

      await Promise.all([...addPromises, ...removePromises]);

      setImportMessage(
        `Imported ${importedOwnedList.length} Pokémon from "${file.name}".`
      );
    } catch (err) {
      console.error("Failed to import collection:", err);
      setImportMessage(
        "Failed to import collection. Please check your file format."
      );
    }
  };

  return (
    <div className="collection">
      <header className="collection-header">
        <div>
          <h1 className="collection-title">My Pokédex Set</h1>
          <p className="collection-subtitle">
            Track your progress towards a complete Pokédex Master Set.
          </p>

          {/* Import / Export controls */}
          <div className="collection-import-export">
            <div className="import-export-buttons">
              <button
                type="button"
                className="collection-import-btn"
                onClick={handleImportClick}
              >
                Import Collection
              </button>

              <button
                type="button"
                className="collection-export-toggle"
                onClick={() => {
                  // Hide import message when export UI is toggled
                  setImportMessage("");

                  // Toggle export options
                  setShowExportOptions((prev) => !prev);
                }}
              >
                Export Collection
              </button>
            </div>

            <input
              ref={importInputRef}
              type="file"
              accept=".csv, text/csv, .json, application/json"
              style={{ display: "none" }}
              onChange={handleImportFileChange}
            />

            {showExportOptions && (
              <div className="collection-export-options">
                <button
                  type="button"
                  className="collection-export-option-btn"
                  onClick={() => handleExportFormatSelect("csv")}
                >
                  Export as CSV
                </button>
                <button
                  type="button"
                  className="collection-export-option-btn"
                  onClick={() => handleExportFormatSelect("json")}
                >
                  Export as JSON
                </button>
              </div>
            )}

            {importMessage && (
              <div className="collection-import-message">{importMessage}</div>
            )}
          </div>
        </div>

        <div className="collection-stats">
          <span className="collection-count">
            {ownedCount} / {MAX_POKEMON} collected
          </span>
        </div>
      </header>

      <div className="collection-progress">
        <div className="collection-progress-bar">
          <div
            className="collection-progress-fill"
            style={{ width: `${completion}%` }}
          />
        </div>
      </div>

      {/* filters */}
      <div className="collection-filters">
        <label className="collection-filter-item">
          <input
            type="checkbox"
            checked={showOwned}
            onChange={(e) => setShowOwned(e.target.checked)}
          />
          <span>Owned</span>
        </label>
        <label className="collection-filter-item">
          <input
            type="checkbox"
            checked={showUnowned}
            onChange={(e) => setShowUnowned(e.target.checked)}
          />
          <span>Not owned</span>
        </label>
      </div>

      {GENERATIONS.map((gen) => {
        const numbers = Array.from(
          { length: gen.end - gen.start + 1 },
          (_, i) => gen.start + i
        );

        // per-generation stats (always based on full data, not filters)
        const totalInGen = numbers.length;
        const ownedInGen = numbers.reduce(
          (acc, dex) => acc + (ownedDex[dex] ? 1 : 0),
          0
        );
        const genCompletion =
          totalInGen > 0 ? (ownedInGen / totalInGen) * 100 : 0;

        return (
          <section key={gen.label} className="collection-generation">
            <div className="collection-generation-header">
              <h2 className="collection-generation-title">{gen.label}</h2>
              <span className="collection-generation-count">
                {ownedInGen} / {totalInGen}
              </span>
            </div>

            <div className="collection-generation-progress">
              <div className="collection-generation-progress-bar">
                <div
                  className="collection-generation-progress-fill"
                  style={{ width: `${genCompletion}%` }}
                />
              </div>
            </div>

            <div className="collection-grid">
              {numbers.map((dexNumber) => {
                const isOwned = !!ownedDex[dexNumber];
                const isVisible =
                  (isOwned && showOwned) || (!isOwned && showUnowned);

                if (!isVisible) {
                  return null;
                }

                const tileClass = `collection-tile${isOwned ? " owned" : ""}${
                  updatingDex === dexNumber ? " updating" : ""
                }`;

                return (
                  <button
                    key={dexNumber}
                    className={tileClass}
                    type="button"
                    onClick={() => handleTileClick(dexNumber, isOwned)}
                    title={
                      isOwned
                        ? "Click to remove from collection"
                        : "Click to add to collection"
                    }
                  >
                    <span className="collection-tile-number">#{dexNumber}</span>

                    <img
                      className={`collection-tile-sprite ${
                        isOwned ? "owned" : "unowned"
                      }`}
                      src={getSpriteUrl(dexNumber)}
                      alt={`Pokémon #${dexNumber} sprite`}
                    />
                  </button>
                );
              })}
            </div>
          </section>
        );
      })}
    </div>
  );
}

export default Collection;
