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
          
        </PageSection>
      </main>
      <WebFooter>
        <a href="/about">About</a>
        <a href="/contact">Contact</a>
      </WebFooter>
    </div>
  );
}

export default About;
