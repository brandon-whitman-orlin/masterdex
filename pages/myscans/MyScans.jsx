import React, { useEffect, useState } from "react";
import "../Page.css";
import "./MyScans.css";

import Navbar from "../../components/navbar/Navbar";
import PageSection from "../../components/pagesection/PageSection";
import Scanner from "../../components/scanner/Scanner";
import WebFooter from "../../components/webfooter/WebFooter";

function MyScans() {
  return (
    <div className="contact page">
      <Navbar />
      <main className="main">
        <PageSection large>
          <Scanner />
        </PageSection>
      </main>
      <WebFooter>
        <a href="/about">About</a>
        {/* <a href="/contact">Contact</a> */}
      </WebFooter>
    </div>
  );
}

export default MyScans;
