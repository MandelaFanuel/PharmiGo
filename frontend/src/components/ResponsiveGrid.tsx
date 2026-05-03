import React from 'react';
import './ResponsiveGrid.css';

interface ResponsiveGridProps {
  children: React.ReactNode;
}

const ResponsiveGrid: React.FC<ResponsiveGridProps> = ({ children }) => {
  return (
    <div className="responsive-grid">
      {children}
    </div>
  );
};

export default ResponsiveGrid;