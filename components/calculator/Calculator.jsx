import React, { useState, useEffect } from "react";
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
  return { ...result, dexNumber, name: trimmed };
}

export function Calculator() {
  const [inputValue, setInputValue] = useState("");
  const [result, setResult] = useState(null);

  const [nameToDex, setNameToDex] = useState({});
  const [loadingDex, setLoadingDex] = useState(true);
  const [dexError, setDexError] = useState(null);

  // Fetch Pokédex data once on mount
  useEffect(() => {
    async function loadPokedex() {
      try {
        setLoadingDex(true);
        setDexError(null);

        // This returns the first 1025 Pokémon in order
        const res = await fetch(
          `https://pokeapi.co/api/v2/pokemon?limit=${MAX_POKEMON}&offset=0`
        );

        if (!res.ok) {
          throw new Error(`HTTP ${res.status}`);
        }

        const data = await res.json();

        // Build name → dexNumber map
        const map = {};
        data.results.forEach((pokemon, index) => {
          // IDs line up with the order, but we can also parse from URL for safety
          const idFromUrl = pokemon.url
            .split("/")
            .filter(Boolean)
            .pop();
          const id = Number(idFromUrl) || index + 1;

          if (id >= 1 && id <= MAX_POKEMON) {
            map[pokemon.name.toLowerCase()] = id;
          }
        });

        setNameToDex(map);
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

  const handleLookup = () => {
    const res = lookupPokemon(inputValue, nameToDex);
    setResult(res);
  };

  const handleKeyDown = (e) => {
    if (e.key === "Enter") {
      handleLookup();
    }
  };

  return (
    <div className="calculator">
      <h1>
        <span className="logo"></span>
        Pokédex Binder Helper
      </h1>

      <div className="subtitle">
        Easily organize your Pokédex Master Set with this app.
      </div>

      <div className="input-row">
        <input
          id="search"
          type="text"
          placeholder="e.g. Turtwig"
          autoComplete="off"
          value={inputValue}
          onChange={(e) => setInputValue(e.target.value)}
          onKeyDown={handleKeyDown}
        />
        <button onClick={handleLookup}>Find Position</button>
      </div>

      <div className="hint">
        You're using 3 × 360-slot binders (40 pages each, 9 cards per page).
        {loadingDex && (
          <> &nbsp;• Loading Pokédex data from PokéAPI…</>
        )}
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
