import React, { useEffect, useState } from "react";
import "../Page.css";
import "./MyCollection.css";

import Navbar from "../../components/navbar/Navbar";
import PageSection from "../../components/pagesection/PageSection";
import Collection from "../../components/collection/Collection";
import WebFooter from "../../components/webfooter/WebFooter";

function MyCollection() {
  return (
    <div className="mycollection page">
      <Navbar />
      <main className="main">
        <PageSection large>
            <Collection/>
        </PageSection>
      </main>
      <WebFooter>
        <a href="/about">About</a>
        {/* <a href="/contact">Contact</a> */}
      </WebFooter>
    </div>
  );
}

export default MyCollection;
