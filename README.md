# Social Media Agent

A multi-agent social media post generator powered by Claude + live web search.

## Quick Start

You need **Node.js 18+** installed. Get it from https://nodejs.org

### 1. Set up the backend

```bash
cd backend
npm install
cp .env.example .env
```

Open `.env` and paste your Anthropic API key:
```
ANTHROPIC_API_KEY=sk-ant-your-key-here
```

Get your key from: https://console.anthropic.com

Start the backend:
```bash
npm run dev
```

You should see: `✅  Backend running at http://localhost:3001`

### 2. Set up the frontend (new terminal)

```bash
cd frontend
npm install
npm run dev
```

You should see: `➜  Local: http://localhost:5173`

### 3. Open the app

Go to **http://localhost:5173** in your browser.

---

## How to use

Just type what you want, naturally:

- "Write a LinkedIn post about AI trends"
- "Instagram post about my coffee shop launch"
- "Tweet about the importance of sleep"
- "WhatsApp broadcast for our weekend sale"

The agent will:
1. Detect the platform and topic
2. Search the web for the latest trends
3. Write a platform-native post grounded in real data

---

## Project structure

```
social-media-agent/
├── backend/
│   ├── server.js       # Express proxy server (keeps API key safe)
│   ├── package.json
│   └── .env.example    # Copy to .env and add your key
└── frontend/
    ├── src/
    │   ├── App.jsx     # Main React app
    │   └── main.jsx    # Entry point
    ├── index.html
    ├── package.json
    └── vite.config.js
```

## Supported platforms

| Platform  | Style |
|-----------|-------|
| Instagram | Visual caption, emojis, hashtags |
| LinkedIn  | Professional thought-leadership |
| X/Twitter | Punchy, under 280 chars |
| Facebook  | Conversational, community-first |
| WhatsApp  | Warm broadcast message |
