// src/components/binders/Binders.jsx
import React, { useEffect, useState } from "react";
import "./Binders.css";

import { useAuth } from "../../src/AuthContext";
import { db } from "../../src/firebase";
import { collection, onSnapshot } from "firebase/firestore";

const MAX_POKEMON = 1025;
const SLOTS_PER_PAGE = 9;
const PAGES_PER_BINDER = 40;
const SLOTS_PER_BINDER = SLOTS_PER_PAGE * PAGES_PER_BINDER;
const BINDER_COUNT = 3;

// sprite URL
function getSpriteUrl(dexNumber) {
  return `https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/${dexNumber}.png`;
}

// position → dex
function getDexFromPosition(binderIndex, pageIndex, slotIndex) {
  const binderOffset = (binderIndex - 1) * SLOTS_PER_BINDER;
  const pageOffset = (pageIndex - 1) * SLOTS_PER_PAGE;
  const slotOffset = slotIndex - 1;

  const zeroBased = binderOffset + pageOffset + slotOffset;
  const dexNumber = zeroBased + 1;

  if (dexNumber < 1 || dexNumber > MAX_POKEMON) return null;
  return dexNumber;
}

export default function Binders() {
  const { user } = useAuth();

  const [ownedDex, setOwnedDex] = useState({});
  const [dexToName, setDexToName] = useState({});
  const [dexToType, setDexToType] = useState({}); // NEW — primary type lookup

  const [currentBinder, setCurrentBinder] = useState(1);
  const [currentPage, setCurrentPage] = useState(1);

  // Read collection
  useEffect(() => {
    if (!user) {
      setOwnedDex({});
      return;
    }

    const colRef = collection(db, "users", user.uid, "collection");

    const unsubscribe = onSnapshot(colRef, (snapshot) => {
      const map = {};
      snapshot.forEach((docSnap) => {
        const data = docSnap.data();
        const dex = data.dexNumber ?? Number.parseInt(docSnap.id, 10) ?? null;
        if (dex && dex >= 1 && dex <= MAX_POKEMON) map[dex] = true;
      });
      setOwnedDex(map);
    });

    return () => unsubscribe();
  }, [user]);

  // Load names + types from PokéAPI
  useEffect(() => {
    async function loadDex() {
      try {
        // Step 1 — Load names
        const res = await fetch(
          `https://pokeapi.co/api/v2/pokemon?limit=${MAX_POKEMON}&offset=0`
        );
        const data = await res.json();

        const nameMap = {};
        const urls = [];

        data.results.forEach((p, index) => {
          const idFromUrl = p.url.split("/").filter(Boolean).pop();
          const id = Number(idFromUrl) || index + 1;

          if (id >= 1 && id <= MAX_POKEMON) {
            nameMap[id] = p.name;
            urls.push({ id, url: p.url });
          }
        });

        setDexToName(nameMap);

        // Step 2 — Load types (primary only)
        const typeMap = {};

        // small batches so we don't spam API too hard
        const chunk = 50;
        for (let i = 0; i < urls.length; i += chunk) {
          const batch = urls.slice(i, i + chunk);

          const results = await Promise.all(
            batch.map(async ({ id, url }) => {
              try {
                const res = await fetch(url);
                const data = await res.json();
                const primary = data.types?.[0]?.type?.name ?? null;
                return { id, type: primary };
              } catch {
                return { id, type: null };
              }
            })
          );

          results.forEach(({ id, type }) => {
            if (type) typeMap[id] = type;
          });
        }

        setDexToType(typeMap);
      } catch (err) {
        console.error("Failed loading Pokédex data:", err);
      }
    }

    loadDex();
  }, []);

  useEffect(() => {
    if (currentPage % 2 === 0) {
      setCurrentPage((prev) => (prev > 1 ? prev - 1 : 1));
    }
  }, [currentPage]);

  const leftPage = currentPage;
  const rightPage =
    currentPage + 1 <= PAGES_PER_BINDER ? currentPage + 1 : null;

  const canGoPrev = currentPage > 1;
  const canGoNext = currentPage + 1 < PAGES_PER_BINDER;

  const handlePrevSpread = () => {
    if (currentPage > 1) setCurrentPage(currentPage - 2);
  };

  const handleNextSpread = () => {
    if (currentPage + 1 < PAGES_PER_BINDER) setCurrentPage(currentPage + 2);
  };

  const handleBinderChange = (binderIndex) => {
    setCurrentBinder(binderIndex);
    setCurrentPage(1);
  };

  // Render one page (3×3)
  const renderPage = (binderIndex, pageIndex, side) => {
    if (!pageIndex)
      return (
        <div
          className={`binder-page binder-page--${side} binder-page--empty`}
        />
      );

    const slots = Array.from({ length: 9 }, (_, i) => i + 1);

    return (
      <div className={`binder-page binder-page--${side}`}>
        <div className="binder-page-header">
          <span className="binder-page-label">
            Binder {binderIndex} · Page {pageIndex}
          </span>
        </div>

        <div className="binder-grid">
          {slots.map((slotIndex) => {
            const dexNumber = getDexFromPosition(
              binderIndex,
              pageIndex,
              slotIndex
            );

            // --- EMPTY SLOT ---
            if (!dexNumber) {
              // Calculate the virtual dex number for display
              const virtualDex =
                (binderIndex - 1) * SLOTS_PER_BINDER +
                (pageIndex - 1) * SLOTS_PER_PAGE +
                (slotIndex - 1) +
                1;

              return (
                <div
                  key={slotIndex}
                  className="binder-slot binder-slot--empty"
                  title={`Nothing... yet 😉`}
                >
                  <div className="binder-slot-sprite-wrapper binder-slot-sprite-wrapper--empty" />

                  <div className="binder-slot-meta">
                    <span className="binder-slot-number">#{virtualDex}</span>
                  </div>
                </div>
              );
            }

            // --- FILLED SLOT ---
            const isOwned = !!ownedDex[dexNumber];
            const rawName = dexToName[dexNumber];
            const displayName = rawName
              ? rawName.charAt(0).toUpperCase() + rawName.slice(1)
              : `Pokémon #${dexNumber}`;

            const type = dexToType[dexNumber];
            const typeClass = type ? ` type-${type}` : "";

            return (
              <div
                key={slotIndex}
                title={displayName}
                className={`binder-slot${
                  isOwned ? " binder-slot--owned" : ""
                }${typeClass}`}
              >
                <div className="binder-slot-sprite-wrapper">
                  <img
                    src={getSpriteUrl(dexNumber)}
                    alt={`Pokémon #${dexNumber} sprite`}
                    className="binder-slot-sprite"
                  />
                </div>

                <div className="binder-slot-meta">
                  <span className="binder-slot-number">#{dexNumber}</span>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    );
  };

  return (
    <div className="binders">
      <header className="binders-header">
        <h1 className="binders-title">Binder View</h1>
        <p className="binders-subtitle">
          Visualize your collection in its binder layout.
        </p>
      </header>

      <div className="binders-controls">
        <button
          type="button"
          className="binders-nav-btn"
          onClick={handlePrevSpread}
          disabled={!canGoPrev}
        >
          ‹ Previous
        </button>

        <div className="binders-current-info">
          Binder {currentBinder} · Pages {leftPage}
          {rightPage ? ` - ${rightPage}` : ""}
        </div>

        <button
          type="button"
          className="binders-nav-btn"
          onClick={handleNextSpread}
          disabled={!canGoNext}
        >
          Next ›
        </button>
      </div>

      <div className="binders-spread">
        {renderPage(currentBinder, leftPage, "left")}
        {renderPage(currentBinder, rightPage, "right")}
      </div>

      <div className="binders-selector">
        {Array.from({ length: BINDER_COUNT }, (_, i) => i + 1).map(
          (binderIndex) => (
            <button
              key={binderIndex}
              type="button"
              className={`binders-selector-btn${
                binderIndex === currentBinder ? " active" : ""
              }`}
              onClick={() => handleBinderChange(binderIndex)}
            >
              Binder {binderIndex}
            </button>
          )
        )}
      </div>
    </div>
  );
}
