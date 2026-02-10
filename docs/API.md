# API Reference

REST API endpoints for the Sushi sports commentary platform.

## Base URL

```
https://your-railway-app.up.railway.app/api
```

## Authentication

Admin endpoints require Bearer token:
```
Authorization: Bearer <token>
```

Get token via POST `/api/admin/login`.

## Public Endpoints

### List Active Sessions

```
GET /api/sessions

Response:
[
  {
    "id": "abc123",
    "sport": "football",
    "league": "nfl",
    "gameName": "Chiefs vs Eagles",
    "status": "active",
    "homeTeam": { "id": "1", "name": "Chiefs", "abbreviation": "KC" },
    "awayTeam": { "id": "2", "name": "Eagles", "abbreviation": "PHI" },
    "commentators": [
      { "id": "A", "name": "Big Mike", "team": "away" },
      { "id": "B", "name": "Salty Steve", "team": "home" }
    ]
  }
]
```

### Get Game Data

```
GET /api/sessions/:id/game

Response:
{
  "id": "401220403",
  "name": "Chiefs vs Eagles",
  "status": {
    "state": "in",
    "detail": "Q3 4:32",
    "clock": "4:32",
    "period": 3
  },
  "home": {
    "name": "Chiefs",
    "abbreviation": "KC",
    "score": 21,
    "record": "14-3"
  },
  "away": {
    "name": "Eagles",
    "abbreviation": "PHI",
    "score": 14,
    "record": "15-2"
  },
  "situation": {
    "down": 2,
    "distance": 5,
    "yardLine": "KC 28"
  }
}
```

### Get Game Summary

```
GET /api/sessions/:id/summary

Response (Football):
{
  "teamStats": [...],
  "playerStats": [...],
  "scoring": [...],
  "drives": [
    {
      "description": "9 plays, 75 yards",
      "playList": [
        {
          "text": "P.Mahomes pass to T.Kelce for 15 yards",
          "type": "Pass",
          "yardsGained": 15
        }
      ]
    }
  ]
}

Response (Basketball):
{
  "teamStats": [...],
  "playerStats": [...],
  "plays": [
    {
      "text": "L.James makes 3-point shot",
      "type": "Three Pointer",
      "scoreValue": 3
    }
  ]
}
```

### Get Latest Commentary

```
GET /api/sessions/:id/commentary/latest

Response:
{
  "turns": [
    {
      "speaker": "A",
      "name": "Big Mike",
      "team": "away",
      "text": "Did you see that throw?! Mahomes is on fire!"
    },
    {
      "speaker": "B",
      "name": "Salty Steve",
      "team": "home",
      "text": "Lucky catch. Eagles defense needs to step up."
    }
  ],
  "play": {
    "description": "P.Mahomes pass to T.Kelce for 15 yards",
    "quarter": 3,
    "clock": "4:32",
    "playType": "Pass",
    "result": "Gain of 15",
    "mood": "big_play"
  },
  "score": { "PHI": 14, "KC": 21 },
  "status": "live",
  "timestamp": 1707500000000
}
```

### Get Commentary History

```
GET /api/sessions/:id/commentary/history

Response:
[
  {
    "turns": [...],
    "play": {...},
    "timestamp": 1707500000000
  }
]
```

### Get News

```
GET /api/sessions/:id/news

Response:
[
  {
    "headline": "Chiefs Win Super Bowl LVII",
    "description": "...",
    "published": "2023-02-12T23:30:00Z",
    "image": "https://...",
    "link": "https://..."
  }
]
```

### Text-to-Speech

```
POST /api/tts
Content-Type: application/json

Request:
{
  "text": "What an incredible play!"
}

Response:
{
  "audio": "base64_encoded_wav...",
  "format": "wav",
  "sample_rate": 22050
}
```

## Admin Endpoints

### Login

```
POST /api/admin/login
Content-Type: application/json

Request:
{
  "password": "your_admin_password"
}

Response:
{
  "token": "abc123xyz789..."
}
```

### Verify Token

```
GET /api/admin/verify
Authorization: Bearer <token>

Response:
{ "ok": true }
```

### List Sports

```
GET /api/admin/sports
Authorization: Bearer <token>

Response:
{
  "football": {
    "name": "Football",
    "leagues": [
      { "id": "nfl", "name": "NFL" },
      { "id": "college-football", "name": "College Football" }
    ]
  },
  "basketball": {
    "name": "Basketball",
    "leagues": [
      { "id": "nba", "name": "NBA" },
      { "id": "ncaam", "name": "NCAAM" }
    ]
  }
}
```

### Browse Games

```
GET /api/admin/browse/:sport/:league?date=YYYYMMDD
Authorization: Bearer <token>

Response:
{
  "sport": "football",
  "league": "nfl",
  "events": [
    {
      "id": "401220403",
      "name": "Chiefs vs Eagles",
      "date": "2023-02-12T23:30:00Z",
      "status": { "state": "in", "detail": "Q3 4:32" },
      "home": { "id": "1", "name": "Chiefs", "abbreviation": "KC", "score": 21 },
      "away": { "id": "2", "name": "Eagles", "abbreviation": "PHI", "score": 14 }
    }
  ]
}
```

### Create Session

```
POST /api/admin/sessions
Authorization: Bearer <token>
Content-Type: application/json

Request:
{
  "sport": "football",
  "league": "nfl",
  "espnEventId": "401220403",
  "gameName": "Chiefs vs Eagles",
  "homeTeam": { "id": "1", "name": "Chiefs", "abbreviation": "KC" },
  "awayTeam": { "id": "2", "name": "Eagles", "abbreviation": "PHI" },
  "commentators": [
    { "id": "A", "name": "Big Mike", "team": "away", "personality": "barkley" },
    { "id": "B", "name": "Salty Steve", "team": "home", "personality": "skip" }
  ]
}

Response:
{
  "id": "abc123def456",
  "sport": "football",
  "status": "active",
  ...
}
```

### List Sessions

```
GET /api/admin/sessions
Authorization: Bearer <token>

Response:
[
  {
    "id": "abc123",
    "sport": "football",
    "gameName": "Chiefs vs Eagles",
    "status": "active",
    "createdAt": "2023-02-12T20:00:00Z"
  }
]
```

### Update Session

```
PATCH /api/admin/sessions/:id
Authorization: Bearer <token>
Content-Type: application/json

Request:
{
  "status": "paused",
  "commentators": [...]
}

Response:
{ "id": "abc123", "status": "paused", ... }
```

### Delete Session

```
DELETE /api/admin/sessions/:id
Authorization: Bearer <token>

Response:
{ "ok": true }
```

### Start/Stop Session

```
POST /api/admin/sessions/:id/start
POST /api/admin/sessions/:id/stop
Authorization: Bearer <token>

Response:
{ "id": "abc123", "status": "active" | "paused", ... }
```

## Error Responses

```
400 Bad Request - Missing required fields
401 Unauthorized - Invalid or missing token
404 Not Found - Session/game not found
502 Bad Gateway - ESPN API error
```

Error format:
```
{
  "error": "Error description",
  "message": "Detailed message"
}
```

## Rate Limits

- ESPN API: Cached locally (8s TTL)
- Modal LLM: 5s cooldown between requests
- Commentary: Max 1 request per 5 seconds per session

## WebSocket (Future)

Real-time updates via WebSocket:
```
ws://your-app.up.railway.app/ws/:sessionId

Messages:
{ "type": "commentary", "data": {...} }
{ "type": "score_update", "data": {...} }
```
