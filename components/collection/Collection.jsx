// src/components/Collection/Collection.jsx
import React, { useEffect, useState } from "react";
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

export function Collection() {
  const { user } = useAuth();

  // ownedDex: { [dexNumber]: true }
  const [ownedDex, setOwnedDex] = useState({});
  const ownedCount = Object.keys(ownedDex).length;
  const completion = (ownedCount / MAX_POKEMON) * 100;

  const [updatingDex, setUpdatingDex] = useState(null); // which tile is being written, if any

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
          const dex =
            data.dexNumber ?? Number.parseInt(docSnap.id, 10) ?? null;
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
      // not signed in; do nothing or show a toast/alert if you want
      return;
    }

    try {
      setUpdatingDex(dexNumber);

      const ref = doc(
        db,
        "users",
        user.uid,
        "collection",
        String(dexNumber)
      );

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

      // onSnapshot listener will update ownedDex automatically
    } catch (err) {
      console.error("Failed to toggle collection:", err);
    } finally {
      setUpdatingDex(null);
    }
  };

  return (
    <div className="collection">
      <div className="collection-header">
          <h1 className="collection-title">My Pokédex Set</h1>
          <p className="collection-subtitle">
            Track your progress towards a complete Pokédex Master Set.
          </p>
        <div className="collection-stats">
          <span className="collection-count">
            {ownedCount} / {MAX_POKEMON} collected
          </span>
        </div>
      </div>

      <div className="collection-progress">
        <div className="collection-progress-bar">
          <div
            className="collection-progress-fill"
            style={{ width: `${completion}%` }}
          />
        </div>
      </div>

      {GENERATIONS.map((gen) => {
        const numbers = Array.from(
          { length: gen.end - gen.start + 1 },
          (_, i) => gen.start + i
        );

        // per-generation stats
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
                const tileClass = `collection-tile${
                  isOwned ? " owned" : ""
                }${updatingDex === dexNumber ? " updating" : ""}`;

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
                    <span className="collection-tile-number">
                      #{dexNumber}
                    </span>

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
