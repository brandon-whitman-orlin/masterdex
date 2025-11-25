import React, { useEffect, useState } from "react";
import "../Page.css";
import "./Home.css";

import Navbar from "../../components/navbar/Navbar";
import PageSection from "../../components/pagesection/PageSection";
import Calculator from "../../components/calculator/Calculator";
import WebFooter from "../../components/webfooter/WebFooter";

function Home() {
  return (
    <div className="home page">
      <Navbar />
      <main className="main">
        <PageSection large>
          <Calculator />
        </PageSection>
      </main>
      <WebFooter>
        <a href="/about">About</a>
        <a href="/contact">Contact</a>
      </WebFooter>
    </div>
  );
}

export default Home;
