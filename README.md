# \# SnipBoard

# 

# SnipBoard is a \*\*local-first Electron desktop app\*\* paired with a \*\*Chrome extension\*\* that lets you capture, organize, and store snippets from ChatGPT and other web content.

# 

# It is designed for \*\*personal use\*\*, runs entirely on your machine, and does \*\*not\*\* upload data to any cloud service.

# 

# ---

# 

# \## What it does

# 

# \- Select one or more ChatGPT messages directly in the browser

# \- Send selected content to a local SnipBoard app

# \- Organize clips by tabs (sections), tags, and notes

# \- Capture and store screenshots alongside text

# \- Search and filter across stored clips

# 

# All data is stored locally.

# 

# ---

# 

# \## Features

# 

# \- Electron desktop app (Windows)

# \- Chrome extension (Manifest v3)

# \- Multi-message selection in ChatGPT

# \- Inbox + custom tabs (sections)

# \- Tags, notes, and search

# \- Screenshot capture with thumbnails

# \- Local HTTP bridge (`http://127.0.0.1:4050`)

# \- Persistent storage via Electron `userData`

# 

# ---

# 

# \## Architecture

# 

# \- \*\*Desktop app:\*\* Electron + Node.js

# \- \*\*Extension:\*\* Content script + popup UI

# \- \*\*Communication:\*\* Local HTTP POST (`/add-clip`)

# \- \*\*Storage:\*\* Local JSON + screenshots directory

# \- \*\*No cloud, no accounts, no telemetry\*\*

# 

# ---

# 

# \## Getting started (development)

# 

# \### Prerequisites

# \- Node.js (18+ recommended)

# \- npm

# 

# \### Install \& run

# ```bash

# npm install

# npm start

# 

