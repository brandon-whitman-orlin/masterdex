import React, { useState, useEffect } from "react";
import { useAuth } from "../../src/AuthContext";
import { db } from "../../src/firebase";
import {
  doc,
  setDoc,
  serverTimestamp,
  getDoc,
  deleteDoc,
} from "firebase/firestore";

import "./Calculator.css";

// --- Configuration ---
const MAX_POKEMON = 1025; // current target
const SLOTS_PER_BINDER = 360; // 40 pages × 9 slots
const SLOTS_PER_PAGE = 9;

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

function formatName(name) {
  if (!name) return "";
  return name.charAt(0).toUpperCase() + name.slice(1);
}

// now takes nameToDex as an argument instead of using a global
function lookupPokemon(inputValue, nameToDex) {
  const trimmed = inputValue.trim();

  if (!trimmed) {
    return { error: "Please enter a Pokémon name or Pokédex number." };
  }

  // Try number path first (this works even if PokéAPI failed)
  const asNumber = Number(trimmed);
  if (!Number.isNaN(asNumber) && Number.isInteger(asNumber)) {
    const result = findSlot(asNumber);
    if (result.error) return result;
    return { ...result, dexNumber: asNumber, name: null };
  }

  // If name data isn't loaded, tell the user explicitly
  if (!nameToDex || Object.keys(nameToDex).length === 0) {
    return {
      error:
        "Pokémon name data isn’t loaded yet. Try using a Pokédex number instead.",
    };
  }

  // Try as name
  const nameKey = trimmed.toLowerCase();
  const dexNumber = nameToDex[nameKey];

  if (!dexNumber) {
    return {
      error:
        `I don’t recognize “${trimmed}”. ` +
        "Make sure the name is spelled correctly, or enter a Pokédex number.",
    };
  }

  const result = findSlot(dexNumber);
  if (result.error) return result;
  return { ...result, dexNumber, name: formatName(trimmed) };
}

export function Calculator() {
  const [inputValue, setInputValue] = useState("");
  const [result, setResult] = useState(null);

  const [nameToDex, setNameToDex] = useState({});
  const [pokedexList, setPokedexList] = useState([]); // for suggestions
  const [loadingDex, setLoadingDex] = useState(true);
  const [dexError, setDexError] = useState(null);

  // sprite state
  const [spriteUrl, setSpriteUrl] = useState(null);
  const [spriteLoading, setSpriteLoading] = useState(false);
  const [spriteError, setSpriteError] = useState(null);

  // type-ahead state
  const [suggestions, setSuggestions] = useState([]);
  const [showSuggestions, setShowSuggestions] = useState(false);

  // auth + collection state
  const { user } = useAuth();
  const [saving, setSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState("");
  const [inCollection, setInCollection] = useState(false);

  // Fetch Pokédex data once on mount
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

        const map = {};
        const list = [];

        data.results.forEach((pokemon, index) => {
          const idFromUrl = pokemon.url.split("/").filter(Boolean).pop();
          const id = Number(idFromUrl) || index + 1;

          if (id >= 1 && id <= MAX_POKEMON) {
            const name = pokemon.name.toLowerCase();
            map[name] = id;
            list.push({ name, dex: id });
          }
        });

        setNameToDex(map);
        setPokedexList(list);
      } catch (err) {
        console.error("Failed to load Pokédex data:", err);
        setDexError(
          "Couldn’t load Pokémon names from PokéAPI. Number lookups will still work."
        );
      } finally {
        setLoadingDex(false);
      }
    }

    loadPokedex();
  }, []);

  // fetch sprite for a dex number
  const fetchSprite = async (dexNumber) => {
    if (!dexNumber) {
      setSpriteUrl(null);
      setSpriteError(null);
      return;
    }

    try {
      setSpriteLoading(true);
      setSpriteError(null);

      const res = await fetch(`https://pokeapi.co/api/v2/pokemon/${dexNumber}`);

      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }

      const data = await res.json();
      const url = data?.sprites?.front_default || null;

      setSpriteUrl(url);
    } catch (err) {
      console.error("Couldn’t load sprite:", err);
      setSpriteUrl(null);
      setSpriteError("Couldn’t load sprite for this Pokémon.");
    } finally {
      setSpriteLoading(false);
    }
  };

  const runLookup = (value) => {
    const res = lookupPokemon(value, nameToDex);
    setResult(res);
    setSaveMessage(""); // reset collection status when changing Pokémon

    if (res && !res.error && res.dexNumber) {
      fetchSprite(res.dexNumber);
    } else {
      setSpriteUrl(null);
      setSpriteError(null);
    }
  };

  const handleLookup = () => {
    runLookup(inputValue);
    setShowSuggestions(false);
  };

  const handleInputChange = (e) => {
    const value = e.target.value;
    setInputValue(value);

    const trimmed = value.trim();

    if (!trimmed) {
      setSuggestions([]);
      setShowSuggestions(false);
      return;
    }

    const asNumber = Number(trimmed);
    if (!Number.isNaN(asNumber) && Number.isInteger(asNumber)) {
      setSuggestions([]);
      setShowSuggestions(false);
      return;
    }

    if (!pokedexList.length) {
      setSuggestions([]);
      setShowSuggestions(false);
      return;
    }

    const lower = trimmed.toLowerCase();

    const matches = pokedexList
      .filter((p) => p.name.startsWith(lower))
      .slice(0, 4);

    setSuggestions(matches);
    setShowSuggestions(matches.length > 0);
  };

  const handleKeyDown = (e) => {
    if (e.key === "Enter") {
      handleLookup();
    }
  };

  const handleSuggestionClick = (name) => {
    const formatted = formatName(name);
    setInputValue(formatted);
    setSuggestions([]);
    setShowSuggestions(false);
    runLookup(formatted);
  };

  // check whether current Pokémon is already in this user's collection
  useEffect(() => {
    async function checkInCollection() {
      if (!user || !result || result.error || !result.dexNumber) {
        setInCollection(false);
        return;
      }

      try {
        const ref = doc(
          db,
          "users",
          user.uid,
          "collection",
          String(result.dexNumber)
        );
        const snap = await getDoc(ref);
        setInCollection(snap.exists());
      } catch (err) {
        console.error("Failed to check collection:", err);
        setInCollection(false);
      }
    }

    checkInCollection();
  }, [user, result]);

  const handleAddToCollection = async () => {
    if (!user || !result || result.error || !result.dexNumber) return;

    try {
      setSaving(true);
      setSaveMessage("");

      const userDocRef = doc(
        db,
        "users",
        user.uid,
        "collection",
        String(result.dexNumber)
      );

      await setDoc(
        userDocRef,
        {
          dexNumber: result.dexNumber,
          name: result.name || null,
          addedAt: serverTimestamp(),
        },
        { merge: true }
      );

      setInCollection(true);
      setSaveMessage("Added to your collection!");
    } catch (err) {
      console.error("Failed to save:", err);
      setSaveMessage("Could not save this Pokémon.");
    } finally {
      setSaving(false);
    }
  };

  const handleRemoveFromCollection = async () => {
    if (!user || !result || result.error || !result.dexNumber) return;

    try {
      setSaving(true);
      setSaveMessage("");

      const ref = doc(
        db,
        "users",
        user.uid,
        "collection",
        String(result.dexNumber)
      );

      await deleteDoc(ref);

      setInCollection(false);
      setSaveMessage("Removed from your collection.");
    } catch (err) {
      console.error("Failed to remove:", err);
      setSaveMessage("Could not remove this Pokémon.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="calculator">
      <h1>
        <span className="logo"></span>
        PokedexSet
      </h1>

      <div className="subtitle">
        Easily organize your Pokédex Master Set with this app.
      </div>

      <div className="input-row">
        <div className="input-wrapper">
          <input
            id="search"
            type="text"
            placeholder="e.g. Turtwig"
            autoComplete="off"
            value={inputValue}
            onChange={handleInputChange}
            onKeyDown={handleKeyDown}
            onFocus={() => {
              if (suggestions.length > 0) setShowSuggestions(true);
            }}
            onBlur={() => {
              setTimeout(() => setShowSuggestions(false), 120);
            }}
          />

          {showSuggestions && suggestions.length > 0 && (
            <ul className="suggestions">
              {suggestions.map((p) => (
                <li
                  key={p.dex}
                  className="suggestion-item"
                  onMouseDown={() => handleSuggestionClick(p.name)}
                >
                  <span className="suggestion-name">{formatName(p.name)}</span>
                  <span className="suggestion-number"> (#{p.dex})</span>
                </li>
              ))}
            </ul>
          )}
        </div>

        <button onClick={handleLookup}>Find Position</button>
      </div>

      <div className="hint">
        You're using 3 × 360-slot binders (40 pages each, 9 cards per page).
        {loadingDex && <> &nbsp;• Loading Pokédex data from PokéAPI…</>}
      </div>

      {dexError && <div className="error">{dexError}</div>}

      <div id="output">
        {result && result.error && <div className="error">{result.error}</div>}

        {result && !result.error && (
          <div className="result-card">
            <div className="result-header">
              <div className="result-title">
                {result.name
                  ? `${result.name}: #${result.dexNumber}`
                  : `Pokémon #${result.dexNumber}`}
              </div>
              <div className="result-subtitle">Placement details</div>
            </div>

            <div className="result-top-row">
              {spriteLoading && (
                <div className="sprite-placeholder">Loading sprite…</div>
              )}

              {spriteUrl && !spriteLoading && (
                <div className="sprite-wrapper">
                  <img
                    src={spriteUrl}
                    alt={
                      result.name
                        ? `${result.name} sprite`
                        : `Pokémon #${result.dexNumber} sprite`
                    }
                  />
                </div>
              )}

              {spriteError && (
                <div className="error sprite-error">{spriteError}</div>
              )}

              {user ? (
                <div className="collection-actions">
                  {inCollection ? (
                    <button
                      className="secondary-btn secondary-btn--danger"
                      disabled={saving}
                      onClick={handleRemoveFromCollection}
                    >
                      {saving ? (
                        "Updating..."
                      ) : (
                        <>
                          Remove from <strong>My Collection</strong>
                        </>
                      )}
                    </button>
                  ) : (
                    <button
                      className="secondary-btn"
                      disabled={saving}
                      onClick={handleAddToCollection}
                    >
                      {saving ? (
                        "Saving..."
                      ) : (
                        <>
                          Add to <strong>My Collection</strong>
                        </>
                      )}
                    </button>
                  )}
                  {saveMessage && (
                    <div className="save-message">{saveMessage}</div>
                  )}
                </div>
              ) : (
                <div className="save-message save-message--muted">
                  Sign in to track this Pokémon in your collection.
                </div>
              )}
            </div>

            <div className="result-grid">
              <div className="pill binder-pill">
                <div className="pill-label">Binder</div>
                <div className="pill-value">
                  <strong>{result.binder}</strong> of 3
                </div>
              </div>

              <div className="pill">
                <div className="pill-label">Page</div>
                <div className="pill-value">
                  <strong>{result.page}</strong> (9 cards per page)
                </div>
              </div>

              <div className="pill">
                <div className="pill-label">Slot on Page</div>
                <div className="pill-value">
                  <strong>{result.slotOnPage}</strong> of 9
                </div>
              </div>
            </div>

            {/* {user ? (
              <div className="collection-actions">
                {inCollection ? (
                  <button
                    className="secondary-btn secondary-btn--danger"
                    disabled={saving}
                    onClick={handleRemoveFromCollection}
                  >
                    {saving ? "Updating…" : "Remove from My Collection"}
                  </button>
                ) : (
                  <button
                    className="secondary-btn"
                    disabled={saving}
                    onClick={handleAddToCollection}
                  >
                    {saving ? "Saving…" : "Add to My Collection"}
                  </button>
                )}
                {saveMessage && (
                  <div className="save-message">{saveMessage}</div>
                )}
              </div>
            ) : (
              <div className="save-message save-message--muted">
                Sign in to track this Pokémon in your collection.
              </div>
            )} */}

            <div className="extra-info">
              This is slot {result.slotInBinder} within binder {result.binder}.
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default Calculator;
