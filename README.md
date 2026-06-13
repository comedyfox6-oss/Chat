# Chat Messenger - Neon Edition 🌟

Professional messenger application with voice calls, video calls, groups, and neon UI design.

## 🚀 Features

- **Neon UI Design** - Modern cyberpunk-inspired dark theme
- **Voice & Video Calls** - WebRTC-based real-time communication
- **Phone Registration** - One-time SMS verification
- **Chats & Groups** - Create groups, manage members
- **User Search** - Find users by nickname
- **Profile Customization** - Avatar, bio, status
- **Real-time Messaging** - Socket.io powered live chat
- **Responsive Design** - Works on desktop and mobile

## 🛠️ Tech Stack

### Backend
- Node.js + Express + TypeScript
- PostgreSQL database
- Redis cache
- Socket.io for real-time communication
- WebRTC signaling
- JWT authentication

### Frontend
- React 18 + TypeScript
- Zustand for state management
- Socket.io client
- Vite build tool
- Pure CSS with neon effects
- WebRTC for audio/video

## 📦 Installation

### Prerequisites
- Node.js 18+
- Docker & Docker Compose (optional)
- PostgreSQL 15+ (if not using Docker)
- Redis (if not using Docker)

### Using Docker Compose (Recommended)

```bash
# Clone the repository
git clone <repository-url>
cd Chat

# Start all services
docker-compose up -d

# Access the application
# Frontend: http://localhost:3000
# Backend: http://localhost:3001
```

### Manual Installation

#### Backend Setup
```bash
cd backend

# Install dependencies
npm install

# Create .env file
cp .env.example .env
# Edit .env with your configuration

# Run migrations
npm run migrate

# Start development server
npm run dev
```

#### Frontend Setup
```bash
cd frontend

# Install dependencies
npm install

# Create .env file
echo "VITE_API_URL=http://localhost:3001/api" > .env.local
echo "VITE_SOCKET_URL=http://localhost:3001" >> .env.local

# Start development server
npm run dev
```

## 🔐 Authentication

1. **Register** with phone number and password
2. **Verify** phone via SMS code
3. **Login** with credentials
4. **JWT Token** stored in localStorage

## 🎨 Neon Color Palette

```css
--neon-primary: #00ff88 (Green)
--neon-secondary: #ff006e (Pink)
--neon-tertiary: #00d9ff (Cyan)
--neon-accent: #ffbe0b (Yellow)
--neon-purple: #b537f2 (Purple)
```

## 📱 API Endpoints

### Authentication
- `POST /api/auth/register` - Register user
- `POST /api/auth/verify` - Verify phone number
- `POST /api/auth/login` - Login user
- `GET /api/auth/me` - Get current user
- `GET /api/auth/search` - Search users by username

### Chats
- `GET /api/chats` - Get user chats
- `POST /api/chats/private` - Create private chat
- `POST /api/chats/group` - Create group
- `GET /api/chats/:chatId/messages` - Get messages
- `POST /api/chats/:chatId/messages` - Send message
- `PUT /api/chats/:chatId` - Update chat info

### Calls
- `POST /api/calls/initiate` - Start call
- `POST /api/calls/:callId/accept` - Accept call
- `POST /api/calls/:callId/reject` - Reject call
- `POST /api/calls/:callId/end` - End call
- `GET /api/calls/history` - Call history
- `GET /api/calls/pending` - Pending calls

## 🔌 WebSocket Events

### Client → Server
- `message:send` - Send message
- `chat:typing` - User typing
- `call:initiate` - Start call
- `webrtc:offer` - WebRTC offer
- `webrtc:answer` - WebRTC answer
- `webrtc:iceCandidate` - ICE candidate

### Server → Client
- `message:new` - New message received
- `user:online` - User came online
- `user:offline` - User went offline
- `call:incoming` - Incoming call
- `call:accepted` - Call accepted
- `webrtc:offer` - Received WebRTC offer

## 📸 Screenshots

[Add screenshots of neon UI here]

## 🐛 Development

### Project Structure

```
Chat/
├── backend/
│   ├── src/
│   │   ├── entities/ (Database models)
│   │   ├── services/ (Business logic)
│   │   ├── routes/ (API endpoints)
│   │   ├── middleware/ (Auth, etc)
│   │   ├── socket/ (WebSocket handlers)
│   │   └── index.ts (Main entry)
│   └── package.json
├── frontend/
│   ├── src/
│   │   ├── pages/ (React pages)
│   │   ├── components/ (React components)
│   │   ├── services/ (API client)
│   │   ├── hooks/ (Custom hooks)
│   │   ├── store/ (Zustand stores)
│   │   ├── styles/ (CSS files)
│   │   └── main.tsx
│   └── package.json
├── docker-compose.yml
└── README.md
```

## 🚀 Deployment

### Using Docker

```bash
# Build images
docker-compose build

# Deploy
docker-compose up -d

# View logs
docker-compose logs -f
```

### Environment Variables

**Backend (.env)**
```
NODE_ENV=production
PORT=3001
DATABASE_URL=postgresql://user:password@db:5432/chatdb
REDIS_URL=redis://redis:6379
JWT_SECRET=your-secret-key
TWILIO_ACCOUNT_SID=your-account-sid
TWILIO_AUTH_TOKEN=your-auth-token
TWILIO_PHONE_NUMBER=+1234567890
CORS_ORIGIN=https://yourdomain.com
```

**Frontend (.env.local)**
```
VITE_API_URL=https://api.yourdomain.com
VITE_SOCKET_URL=https://yourdomain.com
```

## 📝 License

MIT License - feel free to use for your projects!

## 👥 Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## 📞 Support

For issues and questions, please open an issue on GitHub.

---

**Made with 💚 and neon vibes ✨**
