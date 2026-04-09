import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import App from '../App'

// Mock WebSocket so tests don't need a real server
class MockWebSocket {
  readyState: number = WebSocket.OPEN
  onopen: ((event: Event) => void) | null = null
  onmessage: ((event: MessageEvent) => void) | null = null
  onerror: ((event: Event) => void) | null = null
  onclose: ((event: CloseEvent) => void) | null = null
  sent: string[] = []
  url: string

  constructor(url: string) {
    this.url = url
  }

  send(data: string) {
    this.sent.push(data)
  }

  close() {
    this.readyState = WebSocket.CLOSED
    this.onclose?.(new CloseEvent('close'))
  }

  /** Simulate an incoming server message */
  receive(msg: object) {
    this.onmessage?.(new MessageEvent('message', { data: JSON.stringify(msg) }))
  }
}

let lastWs: MockWebSocket | null = null

beforeEach(() => {
  lastWs = null
  vi.stubGlobal('WebSocket', class extends MockWebSocket {
    constructor(url: string) {
      super(url)
      lastWs = this
      // Auto-trigger onopen so the send in connectAndSend fires immediately
      setTimeout(() => this.onopen?.(new Event('open')), 0)
    }
  })
})

// ─── Lobby page ───────────────────────────────────────────────────────────────

describe('Lobby page', () => {
  it('renders 创建房间 and 加入房间 buttons', () => {
    render(<App />)
    expect(screen.getByRole('button', { name: '创建房间' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '加入房间' })).toBeInTheDocument()
  })

  it('renders room code input', () => {
    render(<App />)
    expect(screen.getByPlaceholderText('输入 6 位房间码')).toBeInTheDocument()
  })

  it('shows error when joining with less than 6 character code', async () => {
    render(<App />)
    const input = screen.getByPlaceholderText('输入 6 位房间码')
    await userEvent.type(input, 'ABC')
    await userEvent.click(screen.getByRole('button', { name: '加入房间' }))
    expect(screen.getByText('房间码必须是 6 位')).toBeInTheDocument()
  })
})

// ─── Waiting room ─────────────────────────────────────────────────────────────

describe('Waiting room', () => {
  it('shows room code and waiting message after 创建房间', async () => {
    render(<App />)
    await userEvent.click(screen.getByRole('button', { name: '创建房间' }))
    // Simulate server responding with room_created
    await vi.waitFor(() => expect(lastWs).not.toBeNull())
    lastWs!.receive({ type: 'room_created', roomCode: 'ABC123', playerId: 'p1' })
    expect(await screen.findByText('ABC123')).toBeInTheDocument()
    expect(screen.getByText('⏳ 等待中…')).toBeInTheDocument()
  })

  it('shows error for invalid room code (room_not_found)', async () => {
    render(<App />)
    const input = screen.getByPlaceholderText('输入 6 位房间码')
    await userEvent.type(input, 'ZZZZZZ')
    await userEvent.click(screen.getByRole('button', { name: '加入房间' }))
    await vi.waitFor(() => expect(lastWs).not.toBeNull())
    lastWs!.receive({ type: 'error', message: '房间不存在，请检查房间码' })
    expect(await screen.findByText('房间不存在，请检查房间码')).toBeInTheDocument()
  })
})

// ─── Game page ────────────────────────────────────────────────────────────────

const makeGameState = (overrides = {}) => ({
  balls: [
    { id: 0, x: 350, y: 350, vx: 0, vy: 0, pocketed: false, type: 'cue' },
    ...Array.from({ length: 15 }, (_, i) => ({
      id: i + 1, x: 1000 + i * 30, y: 350, vx: 0, vy: 0, pocketed: false,
      type: i < 7 ? 'solid' : i === 7 ? 'black' : 'stripe',
    })),
  ],
  currentPlayer: 0 as const,
  playerGroups: ['unassigned', 'unassigned'] as ['unassigned', 'unassigned'],
  phase: 'playing' as const,
  ballsMoving: false,
  foulPending: false,
  canPlaceCueBall: false,
  winner: null,
  ...overrides,
})

async function startGame(playerIndex: 0 | 1 = 0) {
  render(<App />)
  await userEvent.click(screen.getByRole('button', { name: '创建房间' }))
  await vi.waitFor(() => expect(lastWs).not.toBeNull())
  lastWs!.receive({ type: 'room_created', roomCode: 'ABC123', playerId: 'p1' })
  lastWs!.receive({ type: 'start_game', state: makeGameState(), playerIndex })
  await screen.findByRole('img', { hidden: true }).catch(() => null)
  // Wait for canvas to appear
  await vi.waitFor(() => document.querySelector('canvas'), { timeout: 2000 })
}

describe('Game page', () => {
  it('renders canvas when game starts', async () => {
    render(<App />)
    await userEvent.click(screen.getByRole('button', { name: '创建房间' }))
    await vi.waitFor(() => expect(lastWs).not.toBeNull())
    lastWs!.receive({ type: 'room_created', roomCode: 'ABC123', playerId: 'p1' })
    lastWs!.receive({ type: 'start_game', state: makeGameState(), playerIndex: 0 })
    await vi.waitFor(() => document.querySelector('canvas'))
    expect(document.querySelector('canvas')).toBeTruthy()
  })

  it('shows 你 and 对手 panels in top bar', async () => {
    render(<App />)
    await userEvent.click(screen.getByRole('button', { name: '创建房间' }))
    await vi.waitFor(() => expect(lastWs).not.toBeNull())
    lastWs!.receive({ type: 'room_created', roomCode: 'ABC123', playerId: 'p1' })
    lastWs!.receive({ type: 'start_game', state: makeGameState(), playerIndex: 0 })
    await vi.waitFor(() => screen.queryByText('你'))
    expect(screen.getByText('你')).toBeInTheDocument()
    expect(screen.getByText('对手')).toBeInTheDocument()
  })

  it('shows 轮到你了 when it is player 0 turn and playerIndex is 0', async () => {
    render(<App />)
    await userEvent.click(screen.getByRole('button', { name: '创建房间' }))
    await vi.waitFor(() => expect(lastWs).not.toBeNull())
    lastWs!.receive({ type: 'room_created', roomCode: 'ABC123', playerId: 'p1' })
    lastWs!.receive({ type: 'start_game', state: makeGameState({ currentPlayer: 0 }), playerIndex: 0 })
    await vi.waitFor(() => screen.queryByText('轮到你了'))
    expect(screen.getByText('轮到你了')).toBeInTheDocument()
  })

  it('shows 等待对手… when it is opponent turn', async () => {
    render(<App />)
    await userEvent.click(screen.getByRole('button', { name: '创建房间' }))
    await vi.waitFor(() => expect(lastWs).not.toBeNull())
    lastWs!.receive({ type: 'room_created', roomCode: 'ABC123', playerId: 'p1' })
    lastWs!.receive({ type: 'start_game', state: makeGameState({ currentPlayer: 1 }), playerIndex: 0 })
    await vi.waitFor(() => screen.queryByText('等待对手…'))
    expect(screen.getByText('等待对手…')).toBeInTheDocument()
  })

  it('shows 🎱 放置白球 when canPlaceCueBall is true and it is my turn', async () => {
    render(<App />)
    await userEvent.click(screen.getByRole('button', { name: '创建房间' }))
    await vi.waitFor(() => expect(lastWs).not.toBeNull())
    lastWs!.receive({ type: 'room_created', roomCode: 'ABC123', playerId: 'p1' })
    lastWs!.receive({
      type: 'start_game',
      state: makeGameState({ currentPlayer: 0, canPlaceCueBall: true }),
      playerIndex: 0,
    })
    await vi.waitFor(() => screen.queryByText('🎱 点击放置白球'))
    expect(screen.getByText('🎱 点击放置白球')).toBeInTheDocument()
  })

  it('updates game state on game_state event', async () => {
    render(<App />)
    await userEvent.click(screen.getByRole('button', { name: '创建房间' }))
    await vi.waitFor(() => expect(lastWs).not.toBeNull())
    lastWs!.receive({ type: 'room_created', roomCode: 'ABC123', playerId: 'p1' })
    lastWs!.receive({ type: 'start_game', state: makeGameState({ currentPlayer: 0 }), playerIndex: 0 })
    await vi.waitFor(() => screen.queryByText('轮到你了'))
    // Server switches turn
    lastWs!.receive({ type: 'game_state', state: makeGameState({ currentPlayer: 1 }) })
    await vi.waitFor(() => screen.queryByText('等待对手…'))
    expect(screen.getByText('等待对手…')).toBeInTheDocument()
  })
})

// ─── Game over page ───────────────────────────────────────────────────────────

describe('Game over page', () => {
  it('shows 你赢了 when winner matches playerIndex', async () => {
    render(<App />)
    await userEvent.click(screen.getByRole('button', { name: '创建房间' }))
    await vi.waitFor(() => expect(lastWs).not.toBeNull())
    lastWs!.receive({ type: 'room_created', roomCode: 'ABC123', playerId: 'p1' })
    lastWs!.receive({ type: 'start_game', state: makeGameState(), playerIndex: 0 })
    lastWs!.receive({ type: 'game_over', winner: 0 })
    expect(await screen.findByText('🎉 你赢了！')).toBeInTheDocument()
  })

  it('shows 你输了 when winner does not match playerIndex', async () => {
    render(<App />)
    await userEvent.click(screen.getByRole('button', { name: '创建房间' }))
    await vi.waitFor(() => expect(lastWs).not.toBeNull())
    lastWs!.receive({ type: 'room_created', roomCode: 'ABC123', playerId: 'p1' })
    lastWs!.receive({ type: 'start_game', state: makeGameState(), playerIndex: 0 })
    lastWs!.receive({ type: 'game_over', winner: 1 })
    expect(await screen.findByText('😢 你输了')).toBeInTheDocument()
  })

  it('shows 重新开始 button on game over', async () => {
    render(<App />)
    await userEvent.click(screen.getByRole('button', { name: '创建房间' }))
    await vi.waitFor(() => expect(lastWs).not.toBeNull())
    lastWs!.receive({ type: 'room_created', roomCode: 'ABC123', playerId: 'p1' })
    lastWs!.receive({ type: 'start_game', state: makeGameState(), playerIndex: 0 })
    lastWs!.receive({ type: 'game_over', winner: 0 })
    expect(await screen.findByRole('button', { name: '重新开始' })).toBeInTheDocument()
  })

  it('returns to lobby on 重新开始', async () => {
    render(<App />)
    await userEvent.click(screen.getByRole('button', { name: '创建房间' }))
    await vi.waitFor(() => expect(lastWs).not.toBeNull())
    lastWs!.receive({ type: 'room_created', roomCode: 'ABC123', playerId: 'p1' })
    lastWs!.receive({ type: 'start_game', state: makeGameState(), playerIndex: 0 })
    lastWs!.receive({ type: 'game_over', winner: 0 })
    const restartBtn = await screen.findByRole('button', { name: '重新开始' })
    await userEvent.click(restartBtn)
    expect(screen.getByRole('button', { name: '创建房间' })).toBeInTheDocument()
  })
})

// ─── Opponent disconnect ──────────────────────────────────────────────────────

describe('Opponent disconnected', () => {
  it('shows disconnect message in game', async () => {
    render(<App />)
    await userEvent.click(screen.getByRole('button', { name: '创建房间' }))
    await vi.waitFor(() => expect(lastWs).not.toBeNull())
    lastWs!.receive({ type: 'room_created', roomCode: 'ABC123', playerId: 'p1' })
    lastWs!.receive({ type: 'start_game', state: makeGameState(), playerIndex: 0 })
    lastWs!.receive({ type: 'opponent_disconnected' })
    expect(await screen.findByText('对手已断开连接，游戏暂停')).toBeInTheDocument()
  })
})
