import React from "react";
import "./WebFooter.css";

const WebFooter = ({ children }) => {
  const currentYear = new Date().getFullYear();

  return (
    <footer className="web-footer">
      <p>© {currentYear}{" "}<strong>PokedexSet</strong></p>
      {children}
    </footer>
  );
};

export default WebFooter;
