import React, { useEffect, useState } from "react";
import "../Page.css";
import "./About.css";

import Navbar from "../../components/navbar/Navbar";
import PageSection from "../../components/pagesection/PageSection";
import WebFooter from "../../components/webfooter/WebFooter";

function About() {
  return (
    <div className="about page">
      <Navbar />
      <main className="main">
        <PageSection large>
          <div className="tablet">
            <h1>What is a Pokédex Set?</h1>
            <p>
              A Pokédex Set (or Pokédex Master Set) is the ultimate collecting
              challenge: a single card for every Pokémon in the National Dex
              (all 1025+ Pokémon).
            </p>

            <h2>How PokedexSet Helps</h2>
            <p>
              Sorting over a thousand cards is tedious, especially when you're
              actively adding to your collection.{" "}
              <strong>PokedexSet makes this task trivial!</strong> Simply enter
              a Pokémon's name or number, and we'll tell you instantly where the
              card belongs in your ultimate Pokédex Set.
            </p>
          </div>
        </PageSection>
      </main>
      <WebFooter>
        <a href="/about">About</a>
        {/* <a href="/contact">Contact</a> */}
      </WebFooter>
    </div>
  );
}

export default About;
