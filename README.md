# Route Optimization Project

A full-stack route optimization application for planning efficient travel or delivery routes.

It supports:

- Single-vehicle route optimization (TSP)
- Multi-vehicle route optimization (VRP)
- Interactive route visualization with Google Maps
- Location management via REST APIs

## Tech Stack

- Frontend: React + Vite + Tailwind CSS + Google Maps API
- Backend: Python + Flask + PyMongo
- Database: MongoDB

## Project Structure

```text
Route_Optimization/
  README.md
  backend/
    algorithms/
    app.py
  frontend/
    src/
```

## Prerequisites (Windows, macOS, Linux)

Install the following on your device:

- Python 3.8+
- Node.js 18+ (for frontend)
- npm (bundled with Node.js)
- MongoDB (local instance or MongoDB Atlas)
- Google Maps JavaScript API key

Verify installation:

```bash
python --version
node -v
npm -v
```

## Setup Instructions

### 1. Clone the repository

```bash
git clone <your-repository-url>
cd Route_Optimization
```

### 2. Configure backend

```bash
cd backend
pip install -r requirements.txt
```

Create `backend/.env` from `backend/.env.example` and update values if needed:

```env
PORT=5000
MONGODB_URI=mongodb://127.0.0.1:27017/route_optimization
```

Start backend server:

```bash
python app.py
```

Backend URL: `http://localhost:5000`

### 3. Configure frontend

Open a new terminal:

```bash
cd frontend
npm install
```

Create `frontend/.env` from `frontend/.env.example`:

```env
VITE_GOOGLE_MAPS_API_KEY=your_google_maps_api_key_here
```

Start frontend server:

```bash
npm run dev
```

Frontend URL: `http://localhost:5173`

### 4. Run the app

1. Start backend first.
2. Start frontend in a separate terminal.
3. Open `http://localhost:5173` in your browser.
4. Click on the map to add locations.
5. Use optimization controls to generate routes.

## Environment Templates Included

- `backend/.env.example`
- `frontend/.env.example`

These files contain safe placeholder values only and no real API keys.

## Security Notes

- Do not commit real API keys or production DB credentials.
- Restrict Google Maps API keys by referrer and API scope.
- Use separate `.env` values for development and production.

## Troubleshooting

- Backend DB error: verify `MONGODB_URI` in `backend/.env`.
- Map not loading: verify `VITE_GOOGLE_MAPS_API_KEY` in `frontend/.env`.
- API not reachable: ensure backend is running on port `5000`.
