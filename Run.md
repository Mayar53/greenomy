# Greenomy — run locally

## Backend (Node.js + Express, port 4000)
cd backend
npm install
cp ../.env.example .env   # set JWT_SECRET at minimum
npm start
# http://127.0.0.1:4000
# http://127.0.0.1:4000/api/health

## Frontend (static — serve over HTTP, not file://)
npx serve .
# http://localhost:3000
