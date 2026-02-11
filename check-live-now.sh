#!/bin/bash
# Quick check for live games RIGHT NOW

echo "🔍 Checking for LIVE games at $(date)..."
echo ""

check_sport() {
  local name=$1
  local url=$2
  echo "Checking $name..."

  curl -s "$url" | jq -r '.events[]? | select(.status.type.state == "in") | "  🟢 LIVE: \(.shortName) - \(.status.type.detail) - Score: \(.competitions[0].competitors[0].score)-\(.competitions[0].competitors[1].score)"' 2>/dev/null | head -3

  if [ $? -ne 0 ]; then
    echo "  (No live games)"
  fi
  echo ""
}

check_sport "🏀 NBA" "https://site.api.espn.com/apis/site/v2/sports/basketball/nba/scoreboard"
check_sport "🏈 NFL" "https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard"
check_sport "⚽ EPL" "https://site.api.espn.com/apis/site/v2/sports/soccer/eng.1/scoreboard"
check_sport "🏒 NHL" "https://site.api.espn.com/apis/site/v2/sports/hockey/nhl/scoreboard"
check_sport "⚾ MLB" "https://site.api.espn.com/apis/site/v2/sports/baseball/mlb/scoreboard"

echo "✅ Done! Use these games in /admin"
