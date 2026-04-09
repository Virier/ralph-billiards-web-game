import { WebSocketServer, WebSocket } from 'ws'
import { randomUUID } from 'crypto'

const PORT = 8080
const TABLE_WIDTH = 1400
const TABLE_HEIGHT = 700
const BALL_RADIUS = 14

type BallType = 'solid' | 'stripe' | 'black' | 'cue'
type PlayerGroup = 'unassigned' | 'solid' | 'stripe'

export interface Ball {
  id: number
  x: number
  y: number
  vx: number
  vy: number
  pocketed: boolean
  type: BallType
}

export interface GameState {
  balls: Ball[]
  currentPlayer: 0 | 1
  playerGroups: [PlayerGroup, PlayerGroup]
  phase: 'playing' | 'game_over'
  ballsMoving: boolean
  foulPending: boolean
  canPlaceCueBall: boolean
  winner: number | null
}

interface Room {
  code: string
  players: WebSocket[]
  playerIds: string[]
  state: GameState | null
}

// Client → Server messages
type ClientMessage =
  | { type: 'join_room'; roomCode: string }

// Server → Client messages
type ServerMessage =
  | { type: 'room_created'; roomCode: string; playerId: string }
  | { type: 'room_joined'; roomCode: string; playerId: string }
  | { type: 'error'; message: string }
  | { type: 'start_game'; state: GameState; playerIndex: 0 | 1 }
  | { type: 'opponent_disconnected' }

const rooms = new Map<string, Room>()
const playerRoom = new Map<WebSocket, string>()

function generateRoomCode(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'
  let code: string
  do {
    code = Array.from({ length: 6 }, () => chars[Math.floor(Math.random() * chars.length)]).join('')
  } while (rooms.has(code))
  return code
}

function createInitialGameState(): GameState {
  const balls: Ball[] = []

  // Cue ball at 1/4 from the left, vertically centered
  balls.push({
    id: 0,
    x: TABLE_WIDTH * 0.25,
    y: TABLE_HEIGHT / 2,
    vx: 0,
    vy: 0,
    pocketed: false,
    type: 'cue',
  })

  // Rack position at foot spot (3/4 from left)
  const rackX = TABLE_WIDTH * 0.75
  const rackY = TABLE_HEIGHT / 2
  const rowHeight = BALL_RADIUS * Math.sqrt(3)

  // Standard Chinese 8-ball triangle rack (row by row, apex toward bottom)
  // Row 0: apex; Row 2 center: ball 8
  const rackRows: number[][] = [
    [1],              // row 0 – apex
    [9, 2],           // row 1
    [3, 8, 10],       // row 2 – 8 ball in center
    [4, 11, 5, 12],   // row 3
    [6, 13, 7, 14, 15], // row 4 – base
  ]

  rackRows.forEach((row, rowIndex) => {
    const numBalls = row.length
    row.forEach((ballId, colIndex) => {
      const x = rackX + rowIndex * rowHeight
      const y = rackY + (colIndex - (numBalls - 1) / 2) * BALL_RADIUS * 2

      let type: BallType
      if (ballId === 8) type = 'black'
      else if (ballId >= 1 && ballId <= 7) type = 'solid'
      else type = 'stripe'

      balls.push({ id: ballId, x, y, vx: 0, vy: 0, pocketed: false, type })
    })
  })

  return {
    balls,
    currentPlayer: 0,
    playerGroups: ['unassigned', 'unassigned'],
    phase: 'playing',
    ballsMoving: false,
    foulPending: false,
    canPlaceCueBall: false,
    winner: null,
  }
}

function send(ws: WebSocket, message: ServerMessage): void {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(message))
  }
}

function cleanupRoom(roomCode: string): void {
  const room = rooms.get(roomCode)
  if (!room) return
  for (const player of room.players) {
    playerRoom.delete(player)
  }
  rooms.delete(roomCode)
}

const wss = new WebSocketServer({ port: PORT })

wss.on('listening', () => {
  console.log(`WebSocket server listening on port ${PORT}`)
})

wss.on('connection', (ws) => {
  console.log('Client connected')

  ws.on('message', (data) => {
    let message: ClientMessage
    try {
      message = JSON.parse(data.toString()) as ClientMessage
    } catch {
      return
    }

    if (message.type === 'join_room') {
      const { roomCode } = message

      if (!roomCode) {
        // Create a new room
        const code = generateRoomCode()
        const playerId = randomUUID()
        const room: Room = {
          code,
          players: [ws],
          playerIds: [playerId],
          state: null,
        }
        rooms.set(code, room)
        playerRoom.set(ws, code)
        send(ws, { type: 'room_created', roomCode: code, playerId })
      } else {
        // Join an existing room
        const room = rooms.get(roomCode)

        if (!room) {
          send(ws, { type: 'error', message: '房间不存在，请检查房间码' })
          return
        }

        if (room.players.length >= 2) {
          send(ws, { type: 'error', message: '房间已满' })
          return
        }

        const playerId = randomUUID()
        room.players.push(ws)
        room.playerIds.push(playerId)
        playerRoom.set(ws, roomCode)

        send(ws, { type: 'room_joined', roomCode, playerId })

        // Room is now full – start the game
        const state = createInitialGameState()
        room.state = state

        send(room.players[0], { type: 'start_game', state, playerIndex: 0 })
        send(room.players[1], { type: 'start_game', state, playerIndex: 1 })
      }
    }
  })

  ws.on('close', () => {
    console.log('Client disconnected')
    const roomCode = playerRoom.get(ws)
    if (!roomCode) return

    const room = rooms.get(roomCode)
    if (room) {
      for (const player of room.players) {
        if (player !== ws) {
          send(player, { type: 'opponent_disconnected' })
        }
      }
    }

    cleanupRoom(roomCode)
  })
})
