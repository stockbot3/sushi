# Deployment Guide

Complete setup instructions for Railway and Modal.

## Prerequisites

- GitHub account
- Railway account (https://railway.app)
- Modal account (https://modal.com)
- Firebase project (optional, for persistence)

## Step 1: Modal Setup

### Install Modal CLI

```bash
pip install modal
modal setup
```

### Deploy LLM Endpoint

```bash
cd modal-llm
modal deploy mistral.py
```

Note the URL: `https://yourusername--claudeapps-mistral-mistralmodel-chat.modal.run`

### Deploy TTS Endpoint

```bash
cd modal-llm/piper
modal deploy tts.py
```

Note the URL: `https://yourusername--sushi-piper-tts-tts.modal.run`

## Step 2: Firebase Setup (Optional)

1. Create project at https://console.firebase.google.com
2. Generate service account key:
   - Settings → Service Accounts → Generate New Private Key
3. Save JSON (you'll paste this into Railway)

## Step 3: Railway Setup

### Create Project

1. Go to https://railway.app/dashboard
2. Click "New Project"
3. Select "Deploy from GitHub repo"
4. Choose your forked/cloned repo

### Add Environment Variables

In Railway dashboard → Variables:

```
MODAL_MISTRAL_URL=https://yourusername--claudeapps-mistral-mistralmodel-chat.modal.run
MODAL_PIPER_URL=https://yourusername--sushi-piper-tts-tts.modal.run
ADMIN_PASSWORD=your_secure_admin_password
FIREBASE_SERVICE_ACCOUNT={...paste JSON here...}
```

### Deploy

Railway auto-deploys on push to main. First deploy:
1. Click "Deploy" in Railway dashboard
2. Wait for build (~2-3 minutes)
3. Note the URL: `https://your-app.up.railway.app`

## Step 4: Verify Deployment

### Check Health

```bash
curl https://your-app.up.railway.app/api/status
```

Should return:
```json
{
  "status": "ok",
  "activeSessions": 0,
  "uptime": 123.45
}
```

### Test Admin Login

```bash
curl -X POST https://your-app.up.railway.app/api/admin/login \
  -H "Content-Type: application/json" \
  -d '{"password": "your_secure_admin_password"}'
```

Should return token.

### Test Commentary

1. Open `/admin` in browser
2. Login with password
3. Browse games → select sport → select game
4. Create session
5. Click "Start Session"
6. Check commentary at `/api/sessions/{id}/commentary/latest`

## Step 5: Custom Domain (Optional)

1. In Railway dashboard → Settings → Domains
2. Click "Custom Domain"
3. Add your domain (e.g., `sushi.yourdomain.com`)
4. Update DNS with provided CNAME record
5. Wait for SSL certificate provisioning

## Environment Variables Reference

| Variable | Required | Description |
|----------|----------|-------------|
| `MODAL_MISTRAL_URL` | Yes | Modal LLM endpoint URL |
| `MODAL_PIPER_URL` | Yes | Modal TTS endpoint URL |
| `ADMIN_PASSWORD` | Yes | Admin dashboard password |
| `FIREBASE_SERVICE_ACCOUNT` | No | Firebase service account JSON |
| `PORT` | No | Server port (default: 3007) |

## Troubleshooting

### Build Fails

Check Railway logs:
```
[build] npm install failed
```

Solutions:
- Clear build cache: Railway dashboard → Settings → Clear Cache
- Check package.json is valid
- Verify Node.js version compatibility

### Modal 502 Error

Modal cold start timing out. Solutions:
1. Increase Modal timeout:
   ```python
   @app.function(timeout=60)  # 60 seconds
   ```
2. Use keep_warm (costs more):
   ```python
   @app.function(keep_warm=True)
   ```
3. Check Modal logs: `modal logs <app-name>`

### No Commentary Generated

1. Check ESPN API is returning data:
   ```bash
   curl https://your-app.up.railway.app/api/sessions/{id}/game
   ```
2. Verify session status is "active"
3. Check game is in progress (not pre/post)
4. Check server logs for errors

### Firebase Errors

If using Firebase:
1. Verify `FIREBASE_SERVICE_ACCOUNT` is valid JSON
2. Check Firebase project has Firestore enabled
3. Verify service account has proper permissions

## Cost Estimates

### Railway (Hobby Plan)

- $5/month base + usage
- Typical: $5-15/month for moderate traffic

### Modal

- LLM: ~$0.001-0.01 per commentary request
- TTS: ~$0.0001-0.001 per TTS request
- Typical: $0.50-5/month for moderate usage

### Firebase (Spark Plan)

- Free tier: 50K reads/day, 20K writes/day
- Usually free for small projects

## Monitoring

### Railway Metrics

Dashboard shows:
- CPU/Memory usage
- Request count
- Response times
- Error rates

### Modal Metrics

```bash
modal app show sushi-piper-tts
modal app show claudeapps-mistral
```

Shows:
- Request count
- Cold start time
- Average latency

### Custom Logging

Add to server.js:
```javascript
console.log('[Commentary]', { sessionId, turnCount, latency });
```

View in Railway logs.

## Backup & Recovery

### Database

Firebase Firestore:
- Automatic backups (daily)
- Manual export: Firebase Console → Firestore → Export

### Code

GitHub repo is source of truth. To rollback:
```bash
git revert HEAD
git push origin main
```

## Updates

### Update Dependencies

```bash
npm update
npm outdated  # Check for major updates
```

### Update Modal

```bash
pip install --upgrade modal
modal deploy <file>.py  # Redeploy
```

### Redeploy Railway

Push to main:
```bash
git add .
git commit -m "Update"
git push origin main
```

Railway auto-deploys.

## Support

- Railway Docs: https://docs.railway.app
- Modal Docs: https://modal.com/docs
- ESPN API: http://espn.go.com/static/apis/devcenter/docs/
- Firebase: https://firebase.google.com/docs
