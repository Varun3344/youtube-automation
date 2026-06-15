'use strict';

require('dotenv').config();
const express = require('express');
const { google } = require('googleapis');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const { v4: uuidv4 } = require('uuid');

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Serve static UI files
app.use(express.static(path.join(__dirname)));

const PORT = process.env.PORT || 8080;
const SESSIONS_FILE = path.join(__dirname, 'sessions.json');
const UPLOADS_DIR = path.join(__dirname, 'uploads');

// Ensure uploads directory exists
if (!fs.existsSync(UPLOADS_DIR)) {
  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
}

// ============================================
// MULTER CONFIGURATION (File Upload)
// ============================================
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOADS_DIR),
  filename: (req, file, cb) => {
    const uniqueName = `${Date.now()}-${uuidv4()}${path.extname(file.originalname)}`;
    cb(null, uniqueName);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 2 * 1024 * 1024 * 1024 }, // 2GB
  fileFilter: (req, file, cb) => {
    const allowed = ['video/mp4', 'video/quicktime', 'video/x-msvideo', 'video/webm', 'video/x-matroska', 'video/mpeg'];
    if (allowed.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error(`Unsupported video format: ${file.mimetype}. Allowed: MP4, MOV, AVI, WebM, MKV, MPEG`));
    }
  }
});

// ============================================
// MULTI-ACCOUNT SESSION MANAGER
// ============================================
// Sessions structure: { [email]: { tokens, email, channels, connectedAt } }
let sessions = {};

function loadSessions() {
  try {
    if (fs.existsSync(SESSIONS_FILE)) {
      const data = fs.readFileSync(SESSIONS_FILE, 'utf8');
      sessions = JSON.parse(data);
      console.log(`  [Sessions] Loaded ${Object.keys(sessions).length} account(s)`);
    }
  } catch (err) {
    console.error('  [Sessions] Failed to load sessions.json:', err.message);
    sessions = {};
  }
}

function saveSessions() {
  try {
    fs.writeFileSync(SESSIONS_FILE, JSON.stringify(sessions, null, 2), 'utf8');
  } catch (err) {
    console.error('  [Sessions] Failed to save sessions.json:', err.message);
  }
}

// Load sessions on startup
loadSessions();

// Track active uploads for progress SSE
const activeUploads = new Map();

// ============================================
// OAUTH2 CLIENT FACTORY
// ============================================
function getOAuth2Client() {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const redirectUri = process.env.GOOGLE_REDIRECT_URI || `http://localhost:${PORT}/oauth2callback`;

  if (!clientId || !clientSecret ||
      clientId.includes('YOUR_GOOGLE_CLIENT_ID') ||
      clientSecret.includes('YOUR_GOOGLE_CLIENT_SECRET')) {
    return null;
  }

  return new google.auth.OAuth2(clientId, clientSecret, redirectUri);
}

function getAuthenticatedClient(email, channelId = null) {
  const session = sessions[email];
  if (!session) return null;

  let tokens = null;
  
  if (channelId && session.channels) {
    const ch = session.channels.find(c => c.id === channelId);
    if (ch && ch.tokens) {
      tokens = ch.tokens;
    }
  }

  // Fallback to first channel tokens if no channelId specified
  if (!tokens && session.channels && session.channels.length > 0) {
    const chWithTokens = session.channels.find(c => c.tokens);
    if (chWithTokens) {
      tokens = chWithTokens.tokens;
      channelId = chWithTokens.id;
    }
  }

  // Fallback to top-level tokens for legacy sessions
  if (!tokens) {
    tokens = session.tokens;
  }

  if (!tokens) return null;

  const oauth2Client = getOAuth2Client();
  if (!oauth2Client) return null;

  oauth2Client.setCredentials(tokens);

  // Listen for token refresh events
  oauth2Client.on('tokens', (newTokens) => {
    if (channelId && session.channels) {
      const ch = session.channels.find(c => c.id === channelId);
      if (ch) {
        ch.tokens = { ...ch.tokens, ...newTokens };
        saveSessions();
        console.log(`  [Tokens] Refreshed tokens for ${email} (${channelId})`);
        return;
      }
    }

    session.tokens = { ...session.tokens, ...newTokens };
    saveSessions();
    console.log(`  [Tokens] Refreshed tokens for ${email}`);
  });

  return oauth2Client;
}

// ============================================
// ROUTES: OAuth Authentication
// ============================================

// Initiate Google OAuth
app.get('/auth/google', (req, res) => {
  const oauth2Client = getOAuth2Client();
  if (!oauth2Client) {
    return res.redirect('/?error=env_missing');
  }

  const scopes = [
    'https://www.googleapis.com/auth/youtube.upload',
    'https://www.googleapis.com/auth/youtube.readonly',
    'https://www.googleapis.com/auth/youtube',
    'https://www.googleapis.com/auth/userinfo.email',
    'https://www.googleapis.com/auth/userinfo.profile'
  ];

  const authUrl = oauth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: scopes,
    prompt: 'consent'
  });

  res.redirect(authUrl);
});

// OAuth2 Callback
app.get('/oauth2callback', async (req, res) => {
  const code = req.query.code;
  if (!code) {
    return res.redirect('/?error=no_code');
  }

  const oauth2Client = getOAuth2Client();
  if (!oauth2Client) {
    return res.redirect('/?error=env_missing');
  }

  try {
    // Exchange auth code for tokens
    const { tokens } = await oauth2Client.getToken(code);
    oauth2Client.setCredentials(tokens);

    // Fetch user info
    const oauth2 = google.oauth2({ version: 'v2', auth: oauth2Client });
    const userInfo = await oauth2.userinfo.get();
    const email = userInfo.data.email;
    const name = userInfo.data.name || email.split('@')[0];
    const picture = userInfo.data.picture || '';

    // Fetch all channels accessible by this account
    const youtube = google.youtube({ version: 'v3', auth: oauth2Client });
    
    // First get channels owned by user
    const channelsResponse = await youtube.channels.list({
      part: 'snippet,statistics',
      mine: true
    });

    const newChannels = (channelsResponse.data.items || []).map(item => ({
      id: item.id,
      name: item.snippet.title,
      handle: item.snippet.customUrl || `@${item.snippet.title.replace(/\s+/g, '').toLowerCase()}`,
      avatar: item.snippet.thumbnails?.default?.url || '',
      subscribers: item.statistics?.subscriberCount || '0',
      videoCount: item.statistics?.videoCount || '0',
      tokens: tokens // Store tokens specifically for this channel identity
    }));

    // Initialize or merge session
    if (!sessions[email]) {
      sessions[email] = {
        email,
        name,
        picture,
        channels: [],
        connectedAt: new Date().toISOString()
      };
    } else {
      sessions[email].name = name;
      sessions[email].picture = picture;
      sessions[email].connectedAt = new Date().toISOString();
      if (!sessions[email].channels) {
        sessions[email].channels = [];
      }
    }

    // Merge channels without losing other connected channels
    newChannels.forEach(newCh => {
      const idx = sessions[email].channels.findIndex(c => c.id === newCh.id);
      if (idx !== -1) {
        sessions[email].channels[idx] = {
          ...sessions[email].channels[idx],
          ...newCh
        };
      } else {
        sessions[email].channels.push(newCh);
      }
    });

    saveSessions();
    console.log(`  [Auth] Connected: ${email} with channel(s): ${newChannels.map(c => c.name).join(', ')}`);

    res.redirect('/?auth=success');
  } catch (err) {
    console.error('  [Auth] OAuth Callback Error:', err.message);
    res.redirect(`/?error=auth_failed&msg=${encodeURIComponent(err.message)}`);
  }
});

// ============================================
// ROUTES: Account & Channel Management
// ============================================

// Check if server is configured
app.get('/api/status', (req, res) => {
  const oauth2Client = getOAuth2Client();
  res.json({
    configured: !!oauth2Client,
    accountCount: Object.keys(sessions).length
  });
});

// List all connected accounts and their channels
app.get('/api/accounts', (req, res) => {
  const accounts = Object.values(sessions).map(s => {
    // Strip private OAuth tokens from channels list sent to frontend
    const channelsCopy = (s.channels || []).map(ch => {
      const { tokens, ...rest } = ch;
      return rest;
    });
    return {
      email: s.email,
      name: s.name,
      picture: s.picture,
      channels: channelsCopy,
      connectedAt: s.connectedAt
    };
  });

  res.json({ accounts });
});

// Disconnect an account
app.delete('/api/accounts/:email', (req, res) => {
  const email = decodeURIComponent(req.params.email);
  if (!sessions[email]) {
    return res.status(404).json({ error: 'Account not found' });
  }

  delete sessions[email];
  saveSessions();
  console.log(`  [Auth] Disconnected: ${email}`);
  res.json({ success: true });
});

// Refresh channels for a specific account
app.post('/api/accounts/:email/refresh', async (req, res) => {
  const email = decodeURIComponent(req.params.email);
  const { channelId } = req.body;
  const oauth2Client = getAuthenticatedClient(email, channelId);

  if (!oauth2Client) {
    return res.status(401).json({ error: 'Account not authenticated' });
  }

  try {
    const youtube = google.youtube({ version: 'v3', auth: oauth2Client });
    const channelsResponse = await youtube.channels.list({
      part: 'snippet,statistics',
      mine: true
    });

    const channels = (channelsResponse.data.items || []).map(item => ({
      id: item.id,
      name: item.snippet.title,
      handle: item.snippet.customUrl || `@${item.snippet.title.replace(/\s+/g, '').toLowerCase()}`,
      avatar: item.snippet.thumbnails?.default?.url || '',
      subscribers: item.statistics?.subscriberCount || '0',
      videoCount: item.statistics?.videoCount || '0'
    }));

    sessions[email].channels = channels;
    saveSessions();

    res.json({ success: true, channels });
  } catch (err) {
    console.error(`  [Refresh] Failed for ${email}:`, err.message);
    res.status(500).json({ error: err.message });
  }
});

// ============================================
// ROUTES: Video Upload
// ============================================

// Upload video + metadata
app.post('/api/upload', upload.single('video'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No video file provided' });
    }

    const { title, description, tags, privacyStatus, categoryId, channelId, accountEmail } = req.body;

    if (!title || !channelId || !accountEmail) {
      // Clean up uploaded file
      fs.unlinkSync(req.file.path);
      return res.status(400).json({ error: 'Missing required fields: title, channelId, accountEmail' });
    }

    const oauth2Client = getAuthenticatedClient(accountEmail, channelId);
    if (!oauth2Client) {
      fs.unlinkSync(req.file.path);
      return res.status(401).json({ error: 'Account not authenticated. Please reconnect.' });
    }

    // Create upload tracking ID
    const uploadId = uuidv4();
    const fileSizeMB = (req.file.size / (1024 * 1024)).toFixed(2);

    activeUploads.set(uploadId, {
      status: 'uploading',
      progress: 0,
      logs: [],
      videoId: null,
      error: null,
      fileName: req.file.originalname,
      fileSize: fileSizeMB,
      channelId,
      title
    });

    // Return upload ID immediately, upload continues in background
    res.json({ uploadId, message: 'Upload started' });

    // Perform upload in background
    performUpload(uploadId, oauth2Client, req.file, {
      title,
      description: description || '',
      tags: tags ? tags.split(',').map(t => t.trim()).filter(Boolean) : [],
      privacyStatus: privacyStatus || 'private',
      categoryId: categoryId || '22'
    });

  } catch (err) {
    console.error('  [Upload] Error:', err.message);
    if (req.file && fs.existsSync(req.file.path)) {
      fs.unlinkSync(req.file.path);
    }
    res.status(500).json({ error: err.message });
  }
});

// Background upload function
async function performUpload(uploadId, oauth2Client, file, metadata) {
  const uploadState = activeUploads.get(uploadId);
  const addLog = (text) => {
    uploadState.logs.push({ text, time: Date.now() });
  };

  try {
    addLog(`[INIT] Starting upload pipeline...`);
    addLog(`[FILE] ${file.originalname} (${uploadState.fileSize} MB)`);

    const youtube = google.youtube({ version: 'v3', auth: oauth2Client });

    addLog(`[API] Connecting to YouTube Data API v3...`);
    addLog(`[META] Title: "${metadata.title}"`);
    addLog(`[META] Privacy: ${metadata.privacyStatus}`);

    if (metadata.tags.length > 0) {
      addLog(`[META] Tags: ${metadata.tags.join(', ')}`);
    }

    addLog(`[STREAM] Uploading ${uploadState.fileSize} MB to Google ingest servers...`);

    // Track upload progress using file stream
    const fileSize = file.size;
    const fileStream = fs.createReadStream(file.path);
    let bytesUploaded = 0;

    fileStream.on('data', (chunk) => {
      bytesUploaded += chunk.length;
      uploadState.progress = Math.round((bytesUploaded / fileSize) * 100);
    });

    const insertResponse = await youtube.videos.insert({
      part: 'snippet,status',
      requestBody: {
        snippet: {
          title: metadata.title,
          description: metadata.description,
          tags: metadata.tags,
          categoryId: metadata.categoryId,
        },
        status: {
          privacyStatus: metadata.privacyStatus,
          selfDeclaredMadeForKids: false
        }
      },
      media: {
        mimeType: file.mimetype,
        body: fileStream
      }
    }, {
      // Resumable upload, allow up to 30 min for large files
      timeout: 1800000,
      onUploadProgress: (evt) => {
        if (evt.bytesRead) {
          uploadState.progress = Math.min(Math.round((evt.bytesRead / fileSize) * 100), 99);
        }
      }
    });

    const videoId = insertResponse.data.id;
    uploadState.progress = 100;
    uploadState.status = 'completed';
    uploadState.videoId = videoId;

    addLog(`[SUCCESS] Video uploaded successfully!`);
    addLog(`[VIDEO] ID: ${videoId}`);
    addLog(`[LINK] https://youtube.com/watch?v=${videoId}`);
    addLog(`[DONE] Pipeline completed.`);

    console.log(`  [Upload] Success: ${videoId} - "${metadata.title}"`);

  } catch (err) {
    uploadState.status = 'error';
    uploadState.error = err.message;
    addLog(`[ERROR] Upload failed: ${err.message}`);
    console.error(`  [Upload] Failed:`, err.message);

  } finally {
    // Clean up uploaded file
    try {
      if (fs.existsSync(file.path)) {
        fs.unlinkSync(file.path);
      }
    } catch (e) {
      console.error('  [Cleanup] Failed to delete temp file:', e.message);
    }
  }
}

// SSE endpoint for upload progress
app.get('/api/upload/progress/:id', (req, res) => {
  const uploadId = req.params.id;

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  let lastLogIndex = 0;
  let lastProgress = -1;

  const interval = setInterval(() => {
    const uploadState = activeUploads.get(uploadId);

    if (!uploadState) {
      res.write(`data: ${JSON.stringify({ error: 'Upload not found' })}\n\n`);
      clearInterval(interval);
      res.end();
      return;
    }

    // Send new logs
    while (lastLogIndex < uploadState.logs.length) {
      res.write(`data: ${JSON.stringify({ log: uploadState.logs[lastLogIndex].text })}\n\n`);
      lastLogIndex++;
    }

    // Send progress updates
    if (uploadState.progress !== lastProgress) {
      lastProgress = uploadState.progress;
      res.write(`data: ${JSON.stringify({ progress: uploadState.progress })}\n\n`);
    }

    // Send completion or error
    if (uploadState.status === 'completed') {
      res.write(`data: ${JSON.stringify({
        success: true,
        videoId: uploadState.videoId,
        link: `https://youtube.com/watch?v=${uploadState.videoId}`
      })}\n\n`);
      clearInterval(interval);
      res.end();

      // Clean up after 5 minutes
      setTimeout(() => activeUploads.delete(uploadId), 300000);
    } else if (uploadState.status === 'error') {
      res.write(`data: ${JSON.stringify({ error: uploadState.error })}\n\n`);
      clearInterval(interval);
      res.end();
      setTimeout(() => activeUploads.delete(uploadId), 300000);
    }
  }, 500);

  req.on('close', () => {
    clearInterval(interval);
  });
});

// ============================================
// ROUTES: Reset
// ============================================
app.post('/api/reset', (req, res) => {
  sessions = {};
  saveSessions();
  activeUploads.clear();
  res.json({ success: true });
});

// Default root
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// Error handler for multer
app.use((err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(413).json({ error: 'File too large. Maximum size is 2GB.' });
    }
    return res.status(400).json({ error: `Upload error: ${err.message}` });
  }
  if (err) {
    return res.status(400).json({ error: err.message });
  }
  next();
});

app.listen(PORT, () => {
  console.log(`\n  ╔══════════════════════════════════════════╗`);
  console.log(`  ║   YT Auto Pipeline - Server Running      ║`);
  console.log(`  ║   Dashboard: http://localhost:${PORT}/       ║`);
  console.log(`  ║   Accounts: ${Object.keys(sessions).length} connected                  ║`);
  console.log(`  ╚══════════════════════════════════════════╝\n`);
});
