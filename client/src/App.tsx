import { useState, useEffect, useRef } from 'react'
import type { GameState, ServerMessage, ClientMessage } from './types'

const WS_URL = 'ws://localhost:8080'

type Page = 'lobby' | 'waiting' | 'game' | 'game_over'

interface AppState {
  page: Page
  roomCode: string | null
  playerIndex: 0 | 1 | null
  gameState: GameState | null
  error: string | null
  opponentDisconnected: boolean
  winner: number | null
}

const initialState: AppState = {
  page: 'lobby',
  roomCode: null,
  playerIndex: null,
  gameState: null,
  error: null,
  opponentDisconnected: false,
  winner: null,
}

export default function App() {
  const [state, setState] = useState<AppState>(initialState)
  const [joinCode, setJoinCode] = useState('')
  const wsRef = useRef<WebSocket | null>(null)

  const connectAndSend = (msg: ClientMessage) => {
    setState(prev => ({ ...prev, error: null }))

    const ws = new WebSocket(WS_URL)
    wsRef.current = ws

    ws.onopen = () => {
      ws.send(JSON.stringify(msg))
    }

    ws.onmessage = (event: MessageEvent) => {
      let data: ServerMessage
      try {
        data = JSON.parse(event.data as string) as ServerMessage
      } catch {
        return
      }

      switch (data.type) {
        case 'room_created':
          setState(prev => ({
            ...prev,
            page: 'waiting',
            roomCode: data.roomCode,
            error: null,
          }))
          break
        case 'room_joined':
          setState(prev => ({
            ...prev,
            page: 'waiting',
            roomCode: data.roomCode,
            error: null,
          }))
          break
        case 'start_game':
          setState(prev => ({
            ...prev,
            page: 'game',
            playerIndex: data.playerIndex,
            gameState: data.state,
            error: null,
          }))
          break
        case 'game_state':
          setState(prev => ({ ...prev, gameState: data.state }))
          break
        case 'game_over':
          setState(prev => ({ ...prev, page: 'game_over', winner: data.winner }))
          break
        case 'opponent_disconnected':
          setState(prev => ({ ...prev, opponentDisconnected: true }))
          break
        case 'error':
          setState(prev => ({ ...prev, error: data.message }))
          // Close the failed connection so user can retry
          ws.close()
          wsRef.current = null
          break
      }
    }

    ws.onerror = () => {
      setState(prev => ({ ...prev, error: '无法连接到服务器，请确认服务器已启动' }))
    }

    ws.onclose = () => {
      // Only mark disconnected if we were already in a game
      setState(prev => {
        if (prev.page === 'game' || prev.page === 'waiting') {
          return { ...prev, opponentDisconnected: true }
        }
        return prev
      })
    }
  }

  // Cleanup WS on unmount
  useEffect(() => {
    return () => {
      wsRef.current?.close()
    }
  }, [])

  const handleCreateRoom = () => {
    connectAndSend({ type: 'join_room', roomCode: '' })
  }

  const handleJoinRoom = () => {
    const code = joinCode.trim().toUpperCase()
    if (code.length !== 6) {
      setState(prev => ({ ...prev, error: '房间码必须是 6 位' }))
      return
    }
    connectAndSend({ type: 'join_room', roomCode: code })
  }

  const handleRestart = () => {
    wsRef.current?.close()
    wsRef.current = null
    setJoinCode('')
    setState(initialState)
  }

  if (state.page === 'lobby') {
    return (
      <div style={styles.container}>
        <h1 style={styles.title}>台球双人对战</h1>
        <p style={styles.subtitle}>中式八球 · 实时对战</p>

        <div style={styles.card}>
          <button style={styles.primaryBtn} onClick={handleCreateRoom}>
            创建房间
          </button>

          <div style={styles.divider}>或</div>

          <div style={styles.joinRow}>
            <input
              style={styles.input}
              type="text"
              placeholder="输入 6 位房间码"
              maxLength={6}
              value={joinCode}
              onChange={e => setJoinCode(e.target.value.toUpperCase())}
              onKeyDown={e => e.key === 'Enter' && handleJoinRoom()}
            />
            <button style={styles.secondaryBtn} onClick={handleJoinRoom}>
              加入房间
            </button>
          </div>

          {state.error && <p style={styles.error}>{state.error}</p>}
        </div>
      </div>
    )
  }

  if (state.page === 'waiting') {
    return (
      <div style={styles.container}>
        <h1 style={styles.title}>等待对手加入</h1>

        {state.roomCode && (
          <div style={styles.card}>
            <p style={styles.label}>房间码</p>
            <p style={styles.roomCode}>{state.roomCode}</p>
            <p style={styles.hint}>将房间码分享给对手即可开始游戏</p>
          </div>
        )}

        {state.opponentDisconnected && (
          <div style={styles.alert}>
            <p>对手已断开连接</p>
            <button style={styles.secondaryBtn} onClick={handleRestart}>
              返回大厅
            </button>
          </div>
        )}

        {!state.opponentDisconnected && (
          <div style={styles.spinner}>⏳ 等待中…</div>
        )}
      </div>
    )
  }

  if (state.page === 'game') {
    return (
      <div style={styles.container}>
        {state.opponentDisconnected && (
          <div style={styles.alertOverlay}>
            <div style={styles.alertBox}>
              <p style={styles.alertText}>对手已断开连接，游戏暂停</p>
              <button style={styles.primaryBtn} onClick={handleRestart}>
                返回大厅
              </button>
            </div>
          </div>
        )}
        <div style={styles.gameStub}>
          <p>游戏页面 — 玩家 {state.playerIndex === 0 ? '1' : '2'}</p>
          <p style={{ fontSize: 14, color: '#aaa' }}>（台球桌渲染将在 US-004 实现）</p>
        </div>
      </div>
    )
  }

  if (state.page === 'game_over') {
    return (
      <div style={styles.container}>
        <h1 style={styles.title}>游戏结束</h1>
        <div style={styles.card}>
          <p style={styles.roomCode}>
            {state.winner === state.playerIndex ? '🎉 你赢了！' : '😢 你输了'}
          </p>
          <button style={styles.primaryBtn} onClick={handleRestart}>
            重新开始
          </button>
        </div>
      </div>
    )
  }

  return null
}

// Inline styles — no external CSS dependency needed for now
const styles: Record<string, React.CSSProperties> = {
  container: {
    minHeight: '100vh',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    background: '#1a2a1a',
    color: '#fff',
    fontFamily: 'system-ui, sans-serif',
    padding: 24,
  },
  title: {
    fontSize: 36,
    fontWeight: 700,
    margin: '0 0 8px',
    color: '#7fc97f',
  },
  subtitle: {
    fontSize: 16,
    color: '#888',
    margin: '0 0 32px',
  },
  card: {
    background: '#243324',
    borderRadius: 12,
    padding: '32px 40px',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: 16,
    minWidth: 320,
  },
  primaryBtn: {
    background: '#4caf50',
    color: '#fff',
    border: 'none',
    borderRadius: 8,
    padding: '12px 32px',
    fontSize: 16,
    fontWeight: 600,
    cursor: 'pointer',
    width: '100%',
  },
  secondaryBtn: {
    background: '#2e7d32',
    color: '#fff',
    border: 'none',
    borderRadius: 8,
    padding: '12px 20px',
    fontSize: 15,
    cursor: 'pointer',
    flexShrink: 0,
  },
  divider: {
    color: '#666',
    fontSize: 14,
  },
  joinRow: {
    display: 'flex',
    gap: 8,
    width: '100%',
  },
  input: {
    flex: 1,
    background: '#1a2a1a',
    border: '1px solid #4caf50',
    borderRadius: 8,
    padding: '12px 16px',
    fontSize: 16,
    color: '#fff',
    letterSpacing: 4,
    textTransform: 'uppercase',
    outline: 'none',
    minWidth: 0,
  },
  error: {
    color: '#f44336',
    fontSize: 14,
    margin: 0,
    textAlign: 'center',
  },
  label: {
    color: '#aaa',
    fontSize: 14,
    margin: 0,
  },
  roomCode: {
    fontSize: 40,
    fontWeight: 700,
    letterSpacing: 8,
    color: '#7fc97f',
    margin: 0,
  },
  hint: {
    color: '#888',
    fontSize: 13,
    margin: 0,
    textAlign: 'center',
  },
  spinner: {
    marginTop: 24,
    fontSize: 20,
    color: '#aaa',
  },
  alert: {
    marginTop: 24,
    background: '#3e2020',
    borderRadius: 8,
    padding: '16px 24px',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: 12,
  },
  alertOverlay: {
    position: 'fixed',
    inset: 0,
    background: 'rgba(0,0,0,0.7)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 100,
  },
  alertBox: {
    background: '#1a2a1a',
    border: '1px solid #f44336',
    borderRadius: 12,
    padding: '32px 40px',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: 16,
  },
  alertText: {
    color: '#f44336',
    fontSize: 18,
    margin: 0,
  },
  gameStub: {
    background: '#243324',
    borderRadius: 12,
    padding: '40px 60px',
    textAlign: 'center',
    fontSize: 18,
  },
}

