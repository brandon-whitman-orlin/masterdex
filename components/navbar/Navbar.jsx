import React, { useEffect, useState } from "react";
import "./Navbar.css";

import Dropdown from '../dropdown/Dropdown';

import { ReactComponent as Logo } from "../../assets/icons/logo.svg";

const Navbar = ({ children }) => {
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    const handleScroll = () => {
      if (window.scrollY > 25) {
        setCollapsed(true);
      } else {
        setCollapsed(false);
      }
    };

    window.addEventListener("scroll", handleScroll);

    // Cleanup
    return () => {
      window.removeEventListener("scroll", handleScroll);
    };
  }, []);

  return (
    <div className={`navbar ${collapsed ? "collapsed" : ""}`}>
      <a href="/" aria-label="Homepage">
        <span className="site-logo"><Logo /></span>
        <span className="site-name">PokedexSet</span>
      </a>

      <ul className="nav-list">
        {/* <Dropdown
          label="Shop"
          subItems={[
            {
              label: 'Shop All',
              href: '/shop',
              ariaLabel: 'View all of our items',
            },
          ]}
        /> */}
        <li>
          <a href="/about" aria-label="Learn About Us">
            About
          </a>
        </li>
        {/* <li>
          <a href="/contact" aria-label="Contact Us">
            Contact
          </a>
        </li> */}
      </ul>
    </div>
  );
};

export default Navbar;
