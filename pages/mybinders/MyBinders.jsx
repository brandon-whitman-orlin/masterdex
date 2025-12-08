import React, { useEffect, useState } from "react";
import "../Page.css";
import "./MyBinders.css";

import Navbar from "../../components/navbar/Navbar";
import PageSection from "../../components/pagesection/PageSection";
import Binders from "../../components/binders/Binders";
import WebFooter from "../../components/webfooter/WebFooter";

function MyBinders() {
  return (
    <div className="mybinder page">
      <Navbar />
      <main className="main">
        <PageSection large>
            <Binders/>
        </PageSection>
      </main>
      <WebFooter>
        <a href="/about">About</a>
        {/* <a href="/contact">Contact</a> */}
      </WebFooter>
    </div>
  );
}

export default MyBinders;