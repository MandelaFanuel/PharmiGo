# Plan: Display Registered Pharmacies in 2x2 Grid Layout

## Objective
Display registered pharmacies two by two (side by side) in normal/web mode, and in a single column grid in responsive/mobile mode. The display should be professional and clean.

## Current State
- **Home.tsx** (#pharmacies section): Uses `pharmacy-showcase-list` class which currently displays pharmacies in a single column
- **Search.tsx** with **PharmacyList.tsx**: Already uses `card-grid` class with proper 2-column responsive layout
- **API endpoint**: `/api/pharmacies/` provides the pharmacy data

## Implementation Steps

### Step 1: Update CSS for `.pharmacy-showcase-list`
**File**: `frontend/src/styles/global.css`

Update the `.pharmacy-showcase-list` class to implement a 2-column grid:
```css
.pharmacy-showcase-list,
.prescription-live-list {
  display: grid;
  grid-template-columns: repeat(2, 1fr);  /* Add this for 2-column layout */
  gap: 16px;
}

/* Add responsive behavior */
@media (max-width: 768px) {
  .pharmacy-showcase-list,
  .prescription-live-list {
    grid-template-columns: 1fr;  /* Single column on mobile */
  }
}
```

### Step 2: Verify Consistent Styling
Ensure the pharmacy cards (`pharmacy-showcase-card`) have proper styling:
- Already have `landing-panel-card` class for professional look
- Already have proper padding, border-radius, and shadows
- Already have responsive image handling

### Step 3: Test the Implementation
1. Open the application in a desktop browser - should see 2 pharmacies per row
2. Resize to mobile width (< 768px) - should switch to 1 pharmacy per row
3. Verify the display is professional and clean

## Mermaid Diagram

```mermaid
graph TD
    A[User Request: Display pharmacies 2x2] --> B[Analyze current implementation]
    B --> C{PharmacyList.tsx uses card-grid?}
    C -->|Yes| D[card-grid already has 2-column layout]
    C -->|No| E[Need to update]
    B --> F[Home.tsx uses pharmacy-showcase-list]
    F --> G[Currently single column - needs update]
    
    D --> H[Update pharmacy-showcase-list CSS]
    G --> H
    
    H --> I[Add grid-template-columns: repeat(2, 1fr)]
    I --> J[Add responsive media query]
    J --> K[Test on desktop - 2 columns]
    K --> L[Test on mobile - 1 column]
    L --> M[Verify professional styling]
```

## Files to Modify
1. `frontend/src/styles/global.css` - Update `.pharmacy-showcase-list` class

## Expected Result
- **Desktop/Normal mode**: Pharmacies displayed 2 by 2 (side by side)
- **Mobile/Responsive mode**: Pharmacies displayed in a single column grid
- **Styling**: Professional and clean with existing `landing-panel-card` styling
