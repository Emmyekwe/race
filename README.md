# Arcade Racer App

Real-time multiplayer 3D arcade racing: **React + Vite + React Three Fiber + @react-three/cannon** on the client, **Node.js + Express + Socket.io + Mongoose/MongoDB** on the server.

## Project layout

```
.
├── package.json            # npm workspaces + `npm run dev` (runs both apps)
├── .env.example            # copy to .env
├── server/
│   ├── server.js           # Express REST API + Socket.io rooms, races, snapshot relay
│   ├── db.js               # Mongoose connection (MongoDB Compass-friendly local URI)
│   ├── config.js           # env loading
│   └── models/             # User, Garage, RaceRecord schemas
└── client/
    ├── vite.config.js      # proxies /api and /socket.io to the server
    └── src/
        ├── components/     # Game, RaceTrack, Vehicle, OpponentVehicle, HUD, CarModel …
        ├── screens/        # Auth, Menu (garage + matchmaking), Room (lobby + results)
        ├── net/            # socket.js, api.js, interpolation.js
        ├── state/          # zustand store + per-frame telemetry
        ├── hooks/          # keyboard controls, socket lifecycle, leaderboard
        └── game/           # constants + track geometry math
```

## Prerequisites

- **Node.js 18.18+** (20 LTS or newer recommended)
- **MongoDB Community Server** running locally on port 27017
- **MongoDB Compass** to inspect the data

## Run it

### 1. Start MongoDB and connect Compass

Windows (MongoDB installed as a service — the default installer option):

```powershell
# Start the service if it isn't already running (may need an Administrator terminal)
net start MongoDB
```

No local install? Use Docker instead:

```bash
docker run -d --name racing-mongo -p 27017:27017 mongo:7
```

Then open **MongoDB Compass** → **New connection** → URI `mongodb://localhost:27017` → **Connect**.
The `racing_game` database appears after the first account is created.

### 2. Configure environment

```powershell
# PowerShell
Copy-Item .env.example .env
```

```bash
# bash / macOS / Linux
cp .env.example .env
```

Edit `.env` and set `JWT_SECRET` to a long random string.

### 3. Install dependencies (root + both workspaces)

```bash
npm install
```

### 4. Run the server and client together

```bash
npm run dev
```

- Game client: http://localhost:5173
- API / Socket.io: http://localhost:4000 (health check: http://localhost:4000/api/health)

### 5. Play multiplayer locally

Open http://localhost:5173 in **two browser tabs** (sessions are per-tab), create an account in each,
click **Quick race** in both, then press **Start race** as the host.

### Production build

```bash
npm run build   # builds client/dist
npm start       # server also serves the built client on PORT
```

## Tests

```bash
npm test   # boots the server against mongodb://localhost:27017/racing_game_test and drops it afterwards
```

## Deployment (free) & CI/CD

One free **Render** web service serves the client, REST API and Socket.io; the database is a free **MongoDB Atlas** M0 cluster.
**GitHub Actions** (`.github/workflows/ci-cd.yml`) builds the client, runs the integration tests against a MongoDB service container and checks the Docker images build. Only when everything passes on `main` does it call Render's deploy hook.

One-time setup:

1. **Atlas** — create an M0 cluster, a database user, allow network access from `0.0.0.0/0`, and copy the
   connection string with `/racing_game` as the database name.
2. **GitHub** — push this repository.
3. **Render** — *New → Blueprint*, select the repo (uses `render.yaml`), paste `MONGO_URI` when prompted.
   `JWT_SECRET` is generated for you; the public URL is picked up automatically via `RENDER_EXTERNAL_URL`.
4. **Deploy hook** — Render → service → *Settings → Deploy Hook* → copy the URL, then in GitHub add it as the
   repository secret `RENDER_DEPLOY_HOOK_URL` (*Settings → Secrets and variables → Actions*).

From then on: open a PR → CI runs; merge to `main` → CI runs → Render deploys.

## Controls

| Key | Action |
| --- | --- |
| W / ↑ | Throttle |
| S / ↓ | Brake, then reverse |
| A D / ← → | Steer |
| Space | Handbrake |
| R | Respawn on the track |

## What you'll see in MongoDB Compass

| Collection | Contents |
| --- | --- |
| `users` | `username`, `passwordHash` (bcrypt), `createdAt` |
| `garages` | `userId`, `selectedCarColor`, `topSpeedModifier` |
| `racerecords` | `userId`, `trackName`, `lapTimeMs`, `createdAt` — one document per valid lap |

## How it works

- **Matchmaking** — `room:quickJoin` puts you in an open public lobby (or creates one), `room:create` makes a private room with a 6-character code, `room:join` joins by code. The host starts a 3 s countdown with `race:start`.
- **Transform sync** — each client sends its chassis position + quaternion at 30 Hz (`player:transform`, volatile). The server keeps the latest per player and broadcasts a room snapshot at `TICK_RATE` Hz (default 30, max 60).
- **Interpolation** — remote cars render ~100 ms in the past, lerping position and slerping rotation between the two snapshots that bracket the render time, using a smoothed server clock offset.
- **Laps** — the start/finish line and a halfway checkpoint are Cannon trigger volumes. A lap counts only after passing the checkpoint and crossing the line in the race direction. The server checks each reported lap time against its own clock (±1.5 s) and a minimum plausible time before writing a `RaceRecord`.
- **Leaderboard** — `GET /api/leaderboard?track=oval-speedway` aggregates each driver's best lap; clients refetch whenever the server emits `leaderboard:changed`.

## REST API

| Method | Path | Auth | Description |
| --- | --- | --- | --- |
| GET | `/api/health` | – | Server + DB status |
| POST | `/api/auth/register` | – | `{ username, password }` → `{ token, user, garage }` |
| POST | `/api/auth/login` | – | `{ username, password }` → `{ token, user, garage }` |
| GET | `/api/auth/me` | Bearer | Current user + garage |
| GET | `/api/garage` | Bearer | Garage settings |
| PUT | `/api/garage` | Bearer | `{ selectedCarColor?, topSpeedModifier? }` |
| GET | `/api/leaderboard?track=&limit=` | – | Best lap per driver |
| GET | `/api/records/me?track=` | Bearer | Personal best + recent laps |
