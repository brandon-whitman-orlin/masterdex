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
            <h1>What is a Pokédex Master Set?</h1>
            <p>A Pokédex Master Set (sometimes just called a Pokédex Set) is a collection of every Pokémon Card in the National Dex (all 1025 Pokémon).</p>
          
            <h2>So, what does this tool do?</h2>
            <p>1025 (and counting) cards is a lot, so getting all of them in order can be a time consuming endeavor.</p>
            <p>Especially if you're actively opening packs and collecting new Pokémon.</p>
            <p>PokedexSet makes this tedious task trivial!</p>
            <p>Simply enter the name (or number) of the Pokémon card you'd like to sort, and PokedexSet will tell you exactly where the card goes in your Pokédex.</p>
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
