# TheEye

## Overview
A web application built with React and Vite.

## Tech Stack
- **Frontend**: React 19 with Vite
- **Language**: JavaScript (JSX)
- **Dev Server**: Vite dev server on port 5000
- **Deployment**: Static site (builds to `dist/`)

## Project Structure
```
├── index.html          # Entry HTML
├── src/
│   ├── main.jsx        # React entry point
│   ├── App.jsx         # Root component
│   ├── App.css         # App styles
│   ├── index.css       # Global styles
│   └── assets/         # Static assets
├── public/             # Public static files
├── vite.config.js      # Vite configuration
├── package.json        # Dependencies
└── eslint.config.js    # ESLint config
```

## Development
- Dev server runs on `0.0.0.0:5000`
- Vite is configured to allow Replit proxy hosts
- Hot module replacement (HMR) is enabled

## Deployment
- Target: Static site
- Build command: `npm run build`
- Output directory: `dist/`
