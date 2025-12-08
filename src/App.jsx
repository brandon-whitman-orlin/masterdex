import React from "react";
import { Routes, Route } from "react-router-dom";

import Home from "../pages/home/Home";
import About from "../pages/about/About";
import MyCollection from "../pages/mycollection/MyCollection";
import MyBinders from "../pages/mybinders/MyBinders";
import Contact from "../pages/contact/Contact";

import "./App.css";

const App = () => {
  return (
    <div
      className="app-container"
      style={{ minHeight: "100%", width: "100%", overflowX: "clip" }}
    >
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/about" element={<About />} />
        <Route path="/mycollection" element={<MyCollection />} /> 
        <Route path="/mybinders" element={<MyBinders />} /> 
        <Route path="/contact" element={<Contact />} />
      </Routes>
    </div>
  );
};

export default App;
