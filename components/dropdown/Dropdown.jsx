import React from 'react';
import "./Dropdown.css";

const Dropdown = ({ label, subItems = [] }) => {
  return (
    <li className="dropdown">
      <span tabIndex={0}>
        {label}
      </span>

      {subItems.length > 0 && (
        <ul className="dropdown-menu">
          {subItems.map((item, index) => (
            <li key={index}>
              <a href={item.href} aria-label={item.ariaLabel}>
                {item.label}
              </a>
            </li>
          ))}
        </ul>
      )}
    </li>
  );
};

export default Dropdown;
