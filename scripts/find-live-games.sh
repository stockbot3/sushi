#!/bin/bash
# Find live games across all sports

echo "🔍 Finding LIVE games right now..."
echo ""

echo "🏈 NFL:"
curl -s "https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard" \
  | jq -r '.events[]? | select(.status.type.state == "in") | "  ✅ \(.shortName) - \(.status.type.detail)"' \
  | head -5

echo ""
echo "🏀 NBA:"
curl -s "https://site.api.espn.com/apis/site/v2/sports/basketball/nba/scoreboard" \
  | jq -r '.events[]? | select(.status.type.state == "in") | "  ✅ \(.shortName) - \(.status.type.detail)"' \
  | head -5

echo ""
echo "⚽ EPL (Soccer):"
curl -s "https://site.api.espn.com/apis/site/v2/sports/soccer/eng.1/scoreboard" \
  | jq -r '.events[]? | select(.status.type.state == "in") | "  ✅ \(.shortName) - \(.status.type.detail)"' \
  | head -5

echo ""
echo "⚾ MLB:"
curl -s "https://site.api.espn.com/apis/site/v2/sports/baseball/mlb/scoreboard" \
  | jq -r '.events[]? | select(.status.type.state == "in") | "  ✅ \(.shortName) - \(.status.type.detail)"' \
  | head -5

echo ""
echo "🏒 NHL:"
curl -s "https://site.api.espn.com/apis/site/v2/sports/hockey/nhl/scoreboard" \
  | jq -r '.events[]? | select(.status.type.state == "in") | "  ✅ \(.shortName) - \(.status.type.detail)"' \
  | head -5

echo ""
echo "If no games shown, none are live right now. Check back later!"
