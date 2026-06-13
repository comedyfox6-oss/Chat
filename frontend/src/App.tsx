import React from 'react';
import './styles/globals.css';
import './styles/neon.css';

export default function App() {
  return (
    <div style={{
      width: '100%',
      height: '100vh',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      flexDirection: 'column',
      gap: '20px',
      background: 'linear-gradient(135deg, #0a0e27 0%, #1a0033 100%)'
    }}>
      <h1 className="neon-text" style={{ fontSize: '48px', textAlign: 'center' }}>🚀 CHAT MESSENGER</h1>
      <p style={{ color: 'var(--text-secondary)', fontSize: '18px' }}>Нарушение строится...</p>
      <p style={{ color: 'var(--text-muted)', fontSize: '14px', textAlign: 'center', maxWidth: '600px' }}>
        ✨ Приложение с неоновым стилем готовится к запуску!<br/>
        🎮 Чаты • 📞 Звонки • 🎥 Видео
      </p>
      <div className="neon-loader"></div>
    </div>
  );
}