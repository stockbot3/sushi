# 🔧 Troubleshooting: Why Avatars Aren't Speaking

## 🔴 Main Issue: GAME IS OVER!

From your Railway logs:
```
[Commentary] Game found: {
  name: 'Brighton & Hove Albion at Aston Villa',
  status: 'post',    ← GAME ENDED!
  score: '0-1'
}
```

**The system ONLY generates live commentary for games with status: 'in' (in progress)**

When status is 'post' (finished), it generates pre-game commentary in a loop, wasting Modal tokens.

---

## ✅ SOLUTION: Use a LIVE Game

### Option 1: Find a Live Game NOW
1. Go to https://www.espn.com/soccer/schedule
2. Find a game that's currently LIVE (status: "in progress")
3. Create new session in `/admin` for that game

### Option 2: Wait for Next Game
1. Check game schedule
2. Create session 30 min before kickoff
3. System will start with pre-game banter
4. Then switch to live commentary when game starts

### Option 3: Test with Any Live Sport
```bash
# Check for live games right now:
curl "https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard" | jq '.events[] | select(.status.type.state == "in")'
```

---

## 🐛 Secondary Issue: Voice ID Bug (FIXED)

Your session had:
```json
"commentators": [
  { "name": "Sakura", "voice": "rachel" },        ← Good!
  { "name": "Steve", "voice": "N2lVS1w4EtoT3dr4eOWO" }  ← Bad! (raw ID)
]
```

**Fixed in latest commit**: TTS now converts raw IDs to keys automatically.

**Root cause**: Admin panel bug - will fix next.

---

## 🔥 Modal Token Waste Issue

**Problem**: Modal LLM keeps generating commentary for finished games

**Why**: The system polls commentary endpoint every 8 seconds. For finished games, it generates pre-game banter each time.

**Fix**: Stop the modal waste immediately!

### Stop Wasting Tokens NOW:

1. **Delete the finished session**:
   - Go to `/admin`
   - Delete "Brighton & Hove Albion at Aston Villa" session

2. **Or Pause it** (if you want to keep it):
   ```bash
   # In Railway logs, find the session ID
   # Then pause it via Firestore or admin panel
   ```

---

## 📊 How Modal Is Being Called

From server.js line 542:
```javascript
const r = await fetch(MODAL_MISTRAL_URL, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    messages: [{ role: 'user', content: prompt }]
  })
});
```

**Modal URL**: `https://mousears1090--claudeapps-mistral-mistralmodel-chat.modal.run`

This is being called:
- Every 8-10 seconds when avatar page is open
- For both live AND finished games
- Generating 3 commentary turns each time

---

## 🛠️ Update Modal Deployment

### Check Current Modal Setup:

```bash
cd /Users/akara/.openclaw/workspace/polymarket-prod/claudeapps/apps/sushi
ls -la modal-llm/
```

### Activate venv and deploy:

```bash
# Find your venv
find ~ -name "modal" -type d 2>/dev/null | grep venv

# Or create new one
python3 -m venv venv
source venv/bin/activate

# Install modal
pip install modal

# Login to Modal
modal setup

# Deploy LLM
modal deploy modal_llama.py

# Deploy TTS (Piper)
cd modal-llm/piper
modal deploy tts.py
```

### Check Modal Dashboard:
- Go to https://modal.com
- Check "Apps" for running deployments
- See token usage and costs

---

## 🎯 Complete Fix Checklist

### Immediate (Stop Token Waste):
- [ ] Delete finished game session in `/admin`
- [ ] Close any open avatar pages

### Test with Live Game:
- [ ] Find a LIVE game (ESPN scoreboard)
- [ ] Create new session in `/admin`
- [ ] Use proper voices (rachel, adam, etc.)
- [ ] Open avatar page: `/avatar.html?session=YOUR_ID`
- [ ] Check browser console for `[TTS]` logs
- [ ] Verify audio plays

### Fix Admin Panel (Next):
- [ ] Update voice dropdown to use keys, not IDs
- [ ] Add game status indicator
- [ ] Add "Delete Session" button

---

## 🔍 Debug Commands

### Check for live games NOW:
```bash
# NFL
curl "https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard" \
  | jq '.events[] | select(.status.type.state == "in") | {name, status: .status.type.detail}'

# NBA
curl "https://site.api.espn.com/apis/site/v2/sports/basketball/nba/scoreboard" \
  | jq '.events[] | select(.status.type.state == "in") | {name, status: .status.type.detail}'

# Soccer (EPL)
curl "https://site.api.espn.com/apis/site/v2/sports/soccer/eng.1/scoreboard" \
  | jq '.events[] | select(.status.type.state == "in") | {name, status: .status.type.detail}'
```

### Test your session:
```bash
# Get commentary (should show pre-game for finished games)
curl "https://your-railway-app.up.railway.app/api/sessions/db3a4679d1b7df66/commentary/latest" | jq .

# Get game status
curl "https://your-railway-app.up.railway.app/api/sessions/db3a4679d1b7df66/game" | jq '.status'
```

---

## 💡 Why This Happened

1. **You created a session for a finished game** - Brighton vs Aston Villa ended before you opened avatar page
2. **Avatar page kept polling** - Every 8 seconds, requesting commentary
3. **Server kept calling Modal** - Generating pre-game banter for a finished game
4. **Modal charged for each call** - Wasting tokens on a game that's over

**Prevention**: Always check game is LIVE before creating session!

---

## 🚀 Quick Test (RIGHT NOW)

```bash
# 1. Find a live game
curl "https://site.api.espn.com/apis/site/v2/sports/basketball/nba/scoreboard" | jq '.events[] | select(.status.type.state == "in") | .name'

# If any game is live:
# 2. Go to /admin
# 3. Create new session for that game
# 4. Open avatar page
# 5. SHOULD WORK!
```

---

## 📞 What To Do Next

1. **Delete the Brighton session** (stop token waste)
2. **Wait for a live game** (or find one now)
3. **Create new session** with proper setup
4. **Test avatar page** - should speak!

The system is working fine - you just need a LIVE game! 🏀⚽🏈
