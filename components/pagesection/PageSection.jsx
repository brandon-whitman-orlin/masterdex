import React from 'react';
import PropTypes from 'prop-types';

import "./PageSection.css";

const PageSection = ({ large, reverse, children }) => {
  // Dynamically create a className string based on the props
  let classNames = 'page-section';
  
  if (large) {
    classNames += ' large';
  }
  
  if (reverse) {
    classNames += ' reverse';
  }

  return (
    <section className={classNames}>
      {children}
    </section>
  );
};

// Define prop types for better type checking
PageSection.propTypes = {
  large: PropTypes.bool,
  reverse: PropTypes.bool,
  children: PropTypes.node.isRequired,
};

// Default props for optional properties
PageSection.defaultProps = {
  large: false,
  reverse: false,
};

export default PageSection;
