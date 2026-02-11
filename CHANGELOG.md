# Changelog

All notable changes to the Sushi project.

## [Unreleased]

### Added
- VRM avatar system with Three.js and @pixiv/three-vrm
- Piper TTS on Modal with Amy voice
- Web Speech API fallback for TTS
- Basketball play-by-play support
- Multi-sport commentary engine (football, basketball, baseball, hockey, soccer)
- Lip-sync animation based on audio analysis
- Idle animations (breathing, blinking)
- Facial expression controls (happy, sad, angry, surprised, relaxed)
- Mobile responsive avatar viewer
- TTS fallback UI indicator
- Preset personalities (name, prompt, voice, avatar URL)
- Firebase Storage uploads for avatar models
- HUD recent-play ticker in avatar stream
- Mute/Unmute control for stream audio

### Fixed
- T-pose issue - arms now relaxed at sides
- Basketball plays not showing in commentary
- `drives is not defined` error for non-football sports
- VRM bone naming compatibility (multiple naming conventions)
- Modal 502 error handling with Web Speech fallback
- Stats tab guardrails to prevent crashes on missing data
- Logo enrichment for sessions missing team logos
- Commentary update detection on play/clock/score changes
- Commentator name/emotion tag stripping

### Changed
- Commentary engine now sport-aware (different play extraction per sport)
- Updated parseSummary to include plays array for basketball
- Improved error handling in TTS service
- Commentary prompt enforces rivalry and avoids name callouts

## [1.0.0] - 2024-02-09

### Added
- Initial release
- Express server with ESPN API integration
- Admin dashboard for session management
- AI commentary with Modal LLM
- Football (NFL) play-by-play
- Real-time commentary generation
- Personality-driven commentators (Barkley, Skip, Snoop, Romo)
- Firebase Firestore integration
- Session management (create, start, stop, delete)
- Caching layer for ESPN data
- Pre-game and post-game commentary
- Health check endpoint
- Status endpoint

## Technical Decisions

### Why VRM over Live2D?
- Live2D requires proprietary Cubism Core SDK (license issues)
- VRM is open standard with MIT-licensed libraries
- Better CDN availability
- Same anime aesthetic

### Why Modal over local Piper?
- Modal provides serverless scaling
- No memory pressure on Railway (Piper needs ~150MB)
- Faster cold starts with keep_warm
- Lower cost for sporadic usage

### Why Web Speech fallback?
- Modal cold starts can timeout (>30s)
- Web Speech is instant and free
- Ensures app works even if Modal fails
- Good enough for MVP

## Known Issues

1. **Modal cold start** - First TTS request may timeout (Web Speech fallback activates)
2. **VRM pose** - Some models may not respond to pose adjustments
3. **Basketball plays** - ESPN API structure varies by game, may need more edge case handling

## Future Roadmap

### Short Term
- [ ] Fix remaining T-pose issues with specific VRM models
- [ ] Add more VRM models (male characters, different styles)
- [ ] Improve lip-sync accuracy
- [ ] Add voice selection (multiple Modal voices)

### Medium Term
- [ ] WebSocket real-time updates
- [ ] Custom personality editor in admin
- [ ] Social sharing (tweet highlights)
- [ ] Betting odds integration
- [ ] Historical stats in commentary

### Long Term
- [ ] VTuber streaming integration (OBS plugin)
- [ ] Multi-language support
- [ ] Mobile app (React Native)
- [ ] AI-generated highlights
- [ ] Fantasy sports integration

## Migration Notes

### From Live2D to VRM
1. Replace `avatar.html` with new VRM version
2. Update `public/lib/` with Three.js instead of PixiJS
3. Deploy new VRM models or use CDN
4. Update session config if needed

### Adding Basketball Support
1. Update `buildCommentaryPayload` to handle basketball plays
2. Add sport-specific play type detection
3. Update prompts for basketball context
4. No database migration needed

## Contributors

- @stockbot3 - Initial development

## License

MIT
