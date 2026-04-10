import { WebSocketServer, WebSocket } from 'ws'
import { randomUUID } from 'crypto'
import Matter from 'matter-js'
import {
  TABLE_WIDTH, TABLE_HEIGHT, BALL_RADIUS,
  POCKET_RADIUS, PLAY_LEFT, PLAY_RIGHT, PLAY_TOP, PLAY_BOTTOM,
  MAX_SHOOT_POWER,
  createInitialGameState, allBallsStopped,
  evaluateTurnEnd, validateCueBallPlacement,
} from './gameLogic.js'
import type { Ball, GameState, PlayerGroup } from './gameLogic.js'

export type { Ball, GameState }

const { Engine, World, Bodies, Body, Events } = Matter

const PORT = 8080

// Physics-visible pocket positions (at the inner edge of the playing surface)
const POCKET_DETECTION_RADIUS = POCKET_RADIUS + BALL_RADIUS
const WALL_THICKNESS = 20
const POCKET_GAP = POCKET_RADIUS + BALL_RADIUS + 4

const POCKET_POSITIONS = [
  { x: PLAY_LEFT, y: PLAY_TOP },
  { x: PLAY_RIGHT, y: PLAY_TOP },
  { x: PLAY_LEFT, y: PLAY_BOTTOM },
  { x: PLAY_RIGHT, y: PLAY_BOTTOM },
  { x: TABLE_WIDTH / 2, y: PLAY_TOP },
  { x: TABLE_WIDTH / 2, y: PLAY_BOTTOM },
]

const PHYSICS_FPS = 60
const PHYSICS_DT = 1000 / PHYSICS_FPS
const TURN_TIMEOUT_MS = 60000

interface PhysicsState {
  engine: Matter.Engine
  ballBodies: Map<number, Matter.Body>
  intervalId: ReturnType<typeof setInterval> | null
}

interface Room {
  code: string
  players: WebSocket[]
  playerIds: string[]
  state: GameState | null
  physics: PhysicsState | null
  ballsPocketedThisTurn: number[]
  shooterThisTurn: 0 | 1 | null
  cueBallFirstContact: number | null
  cueBallPocketedThisTurn: boolean
  turnTimeoutId: ReturnType<typeof setTimeout> | null
}

// Client → Server messages
type ClientMessage =
  | { type: 'join_room'; roomCode: string }
  | { type: 'shoot'; dirX: number; dirY: number; power: number }
  | { type: 'place_cue_ball'; x: number; y: number }

// Server → Client messages
type ServerMessage =
  | { type: 'room_created'; roomCode: string; playerId: string }
  | { type: 'room_joined'; roomCode: string; playerId: string }
  | { type: 'error'; message: string }
  | { type: 'start_game'; state: GameState; playerIndex: 0 | 1 }
  | { type: 'game_state'; state: GameState }
  | { type: 'game_over'; winner: 0 | 1 }
  | { type: 'opponent_disconnected' }
  | { type: 'turn_timeout' }

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

function wallSegments(
  from: number,
  to: number,
  pocketCenters: number[],
): Array<[number, number]> {
  const gaps: Array<[number, number]> = pocketCenters.map((c) => [c - POCKET_GAP, c + POCKET_GAP])
  gaps.sort((a, b) => a[0] - b[0])
  const segments: Array<[number, number]> = []
  let cursor = from
  for (const [gStart, gEnd] of gaps) {
    if (gStart > cursor) segments.push([cursor, gStart])
    cursor = Math.max(cursor, gEnd)
  }
  if (cursor < to) segments.push([cursor, to])
  return segments
}

function createWalls(): Matter.Body[] {
  const walls: Matter.Body[] = []
  const wallOptions = { isStatic: true, restitution: 0.65, friction: 0.05, frictionAir: 0, label: 'wall' }

  for (const [s, e] of wallSegments(PLAY_LEFT, PLAY_RIGHT, [PLAY_LEFT, TABLE_WIDTH / 2, PLAY_RIGHT])) {
    const w = e - s
    walls.push(Bodies.rectangle(s + w / 2, PLAY_TOP - WALL_THICKNESS / 2, w, WALL_THICKNESS, wallOptions))
  }
  for (const [s, e] of wallSegments(PLAY_LEFT, PLAY_RIGHT, [PLAY_LEFT, TABLE_WIDTH / 2, PLAY_RIGHT])) {
    const w = e - s
    walls.push(Bodies.rectangle(s + w / 2, PLAY_BOTTOM + WALL_THICKNESS / 2, w, WALL_THICKNESS, wallOptions))
  }
  for (const [s, e] of wallSegments(PLAY_TOP, PLAY_BOTTOM, [PLAY_TOP, PLAY_BOTTOM])) {
    const h = e - s
    walls.push(Bodies.rectangle(PLAY_LEFT - WALL_THICKNESS / 2, s + h / 2, WALL_THICKNESS, h, wallOptions))
  }
  for (const [s, e] of wallSegments(PLAY_TOP, PLAY_BOTTOM, [PLAY_TOP, PLAY_BOTTOM])) {
    const h = e - s
    walls.push(Bodies.rectangle(PLAY_RIGHT + WALL_THICKNESS / 2, s + h / 2, WALL_THICKNESS, h, wallOptions))
  }
  return walls
}

function initPhysics(state: GameState): PhysicsState {
  const engine = Engine.create({ gravity: { x: 0, y: 0, scale: 0 } })
  const ballBodies = new Map<number, Matter.Body>()
  for (const ball of state.balls) {
    if (!ball.pocketed) {
      const body = Bodies.circle(ball.x, ball.y, BALL_RADIUS, {
        restitution: 0.85, friction: 0.005, frictionAir: 0.015, density: 0.002,
        label: `ball_${ball.id}`,
      })
      ballBodies.set(ball.id, body)
      World.add(engine.world, body)
    }
  }
  World.add(engine.world, createWalls())
  return { engine, ballBodies, intervalId: null }
}

function syncPhysicsToState(state: GameState, physics: PhysicsState): void {
  for (const ball of state.balls) {
    if (ball.pocketed) continue
    const body = physics.ballBodies.get(ball.id)
    if (!body) continue
    ball.x = body.position.x
    ball.y = body.position.y
    ball.vx = body.velocity.x
    ball.vy = body.velocity.y
  }
}

function checkPocketed(state: GameState, physics: PhysicsState): number[] {
  const newlyPocketed: number[] = []
  for (const ball of state.balls) {
    if (ball.pocketed) continue
    const body = physics.ballBodies.get(ball.id)
    if (!body) continue
    for (const pocket of POCKET_POSITIONS) {
      const dx = body.position.x - pocket.x
      const dy = body.position.y - pocket.y
      if (Math.sqrt(dx * dx + dy * dy) < POCKET_DETECTION_RADIUS) {
        ball.pocketed = true
        World.remove(physics.engine.world, body)
        physics.ballBodies.delete(ball.id)
        newlyPocketed.push(ball.id)
        break
      }
    }
  }
  return newlyPocketed
}

function broadcastGameState(room: Room): void {
  if (!room.state) return
  const json = JSON.stringify({ type: 'game_state', state: room.state } as ServerMessage)
  for (const player of room.players) {
    if (player.readyState === WebSocket.OPEN) player.send(json)
  }
}

function broadcastGameOver(room: Room, winner: 0 | 1): void {
  const json = JSON.stringify({ type: 'game_over', winner } as ServerMessage)
  for (const player of room.players) {
    if (player.readyState === WebSocket.OPEN) player.send(json)
  }
}

function send(ws: WebSocket, message: ServerMessage): void {
  if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(message))
}

function stopPhysicsLoop(room: Room): void {
  if (room.physics?.intervalId) {
    clearInterval(room.physics.intervalId)
    room.physics.intervalId = null
  }
}

function clearTurnTimer(room: Room): void {
  if (room.turnTimeoutId !== null) {
    clearTimeout(room.turnTimeoutId)
    room.turnTimeoutId = null
  }
}

function placeCueBallBody(room: Room, x: number, y: number): void {
  if (!room.state || !room.physics) return
  const cueBall = room.state.balls.find((b) => b.id === 0)
  if (!cueBall) return
  const oldBody = room.physics.ballBodies.get(0)
  if (oldBody) World.remove(room.physics.engine.world, oldBody)
  cueBall.x = x
  cueBall.y = y
  cueBall.vx = 0
  cueBall.vy = 0
  cueBall.pocketed = false
  const newBody = Bodies.circle(x, y, BALL_RADIUS, {
    restitution: 0.85, friction: 0.005, frictionAir: 0.015, density: 0.002, label: 'ball_0',
  })
  room.physics.ballBodies.set(0, newBody)
  World.add(room.physics.engine.world, newBody)
}

function handleTimeout(room: Room): void {
  if (!room.state || room.state.phase !== 'playing') return
  const state = room.state
  if (state.canPlaceCueBall) {
    const defaultX = state.currentPlayer === 0 ? TABLE_WIDTH * 0.25 : TABLE_WIDTH * 0.75
    placeCueBallBody(room, defaultX, TABLE_HEIGHT / 2)
    state.canPlaceCueBall = false
    state.foulPending = false
  }
  state.currentPlayer = state.currentPlayer === 0 ? 1 : 0
  room.ballsPocketedThisTurn = []
  room.shooterThisTurn = null
  room.cueBallFirstContact = null
  room.cueBallPocketedThisTurn = false
  broadcastGameState(room)
  const json = JSON.stringify({ type: 'turn_timeout' } as ServerMessage)
  for (const player of room.players) {
    if (player.readyState === WebSocket.OPEN) player.send(json)
  }
  startTurnTimer(room)
}

function startTurnTimer(room: Room): void {
  clearTurnTimer(room)
  if (!room.state || room.state.phase !== 'playing') return
  room.turnTimeoutId = setTimeout(() => {
    room.turnTimeoutId = null
    handleTimeout(room)
  }, TURN_TIMEOUT_MS)
}

function handleTurnEnd(room: Room): void {
  if (!room.state) return
  const state = room.state

  const result = evaluateTurnEnd(
    state,
    room.shooterThisTurn,
    room.ballsPocketedThisTurn,
    room.cueBallPocketedThisTurn,
    room.cueBallFirstContact,
  )

  // Reset per-turn tracking
  room.ballsPocketedThisTurn = []
  room.shooterThisTurn = null
  room.cueBallFirstContact = null
  room.cueBallPocketedThisTurn = false

  if (result.gameOver && result.winner !== undefined) {
    state.phase = 'game_over'
    state.winner = result.winner
    state.ballsMoving = false
    broadcastGameState(room)
    broadcastGameOver(room, result.winner)
    stopPhysicsLoop(room)
    clearTurnTimer(room)
    return
  }

  if (!result.keepTurn) {
    state.currentPlayer = state.currentPlayer === 0 ? 1 : 0
  }
  if (result.isFoul) {
    state.foulPending = true
    state.canPlaceCueBall = true
  } else {
    state.foulPending = false
    state.canPlaceCueBall = false
  }

  startTurnTimer(room)
}

function startPhysicsLoop(room: Room): void {
  if (!room.state || !room.physics) return
  const physics = room.physics
  const state = room.state

  Events.on(physics.engine, 'collisionStart', (event) => {
    if (room.cueBallFirstContact !== null) return
    if (!state.ballsMoving) return
    for (const pair of event.pairs) {
      const { bodyA, bodyB } = pair
      const isCueA = bodyA.label === 'ball_0'
      const isCueB = bodyB.label === 'ball_0'
      if (!isCueA && !isCueB) continue
      const otherBody = isCueA ? bodyB : bodyA
      if (!otherBody.label.startsWith('ball_')) continue
      const otherId = parseInt(otherBody.label.replace('ball_', ''), 10)
      if (otherId === 0) continue
      room.cueBallFirstContact = otherId
      break
    }
  })

  physics.intervalId = setInterval(() => {
    Engine.update(physics.engine, PHYSICS_DT)
    syncPhysicsToState(state, physics)
    const newlyPocketed = checkPocketed(state, physics)
    if (newlyPocketed.length > 0) {
      room.ballsPocketedThisTurn.push(...newlyPocketed)
      if (newlyPocketed.includes(0)) room.cueBallPocketedThisTurn = true
    }
    const wasMoved = state.ballsMoving
    state.ballsMoving = !allBallsStopped(state)
    if (wasMoved && !state.ballsMoving) handleTurnEnd(room)
    if (state.ballsMoving || wasMoved) broadcastGameState(room)
  }, PHYSICS_DT)
}

function cleanupRoom(roomCode: string): void {
  const room = rooms.get(roomCode)
  if (!room) return
  stopPhysicsLoop(room)
  clearTurnTimer(room)
  for (const player of room.players) playerRoom.delete(player)
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
        const code = generateRoomCode()
        const playerId = randomUUID()
        const room: Room = {
          code, players: [ws], playerIds: [playerId],
          state: null, physics: null,
          ballsPocketedThisTurn: [], shooterThisTurn: null,
          cueBallFirstContact: null, cueBallPocketedThisTurn: false,
          turnTimeoutId: null,
        }
        rooms.set(code, room)
        playerRoom.set(ws, code)
        send(ws, { type: 'room_created', roomCode: code, playerId })
      } else {
        const room = rooms.get(roomCode)
        if (!room) { send(ws, { type: 'error', message: '房间不存在，请检查房间码' }); return }
        if (room.players.length >= 2) { send(ws, { type: 'error', message: '房间已满' }); return }
        const playerId = randomUUID()
        room.players.push(ws)
        room.playerIds.push(playerId)
        playerRoom.set(ws, roomCode)
        send(ws, { type: 'room_joined', roomCode, playerId })
        const state = createInitialGameState()
        room.state = state
        room.physics = initPhysics(state)
        send(room.players[0], { type: 'start_game', state, playerIndex: 0 })
        send(room.players[1], { type: 'start_game', state, playerIndex: 1 })
        startPhysicsLoop(room)
        startTurnTimer(room)
      }
    } else if (message.type === 'shoot') {
      const roomCode = playerRoom.get(ws)
      if (!roomCode) return
      const room = rooms.get(roomCode)
      if (!room?.state || !room.physics) return
      const rawIdx = room.players.indexOf(ws)
      if (rawIdx === -1) return
      const playerIndex = rawIdx as 0 | 1
      if (room.state.currentPlayer !== playerIndex) return
      if (room.state.ballsMoving) return
      if (room.state.phase !== 'playing') return
      if (room.state.canPlaceCueBall) return
      const cueBall = room.state.balls.find((b) => b.id === 0)
      if (!cueBall || cueBall.pocketed) return
      const cueBallBody = room.physics.ballBodies.get(0)
      if (!cueBallBody) return
      const power = Math.max(0, Math.min(100, message.power)) / 100
      const forceMagnitude = power * MAX_SHOOT_POWER
      const len = Math.sqrt(message.dirX * message.dirX + message.dirY * message.dirY)
      if (len === 0) return
      clearTurnTimer(room)
      Body.applyForce(cueBallBody, cueBallBody.position, {
        x: (message.dirX / len) * forceMagnitude,
        y: (message.dirY / len) * forceMagnitude,
      })
      room.state.ballsMoving = true
      room.shooterThisTurn = playerIndex
      room.ballsPocketedThisTurn = []
      room.cueBallFirstContact = null
      room.cueBallPocketedThisTurn = false
    } else if (message.type === 'place_cue_ball') {
      const roomCode = playerRoom.get(ws)
      if (!roomCode) return
      const room = rooms.get(roomCode)
      if (!room?.state || !room.physics) return
      if (!room.state.canPlaceCueBall) return
      const rawPlaceIdx = room.players.indexOf(ws)
      if (rawPlaceIdx === -1) return
      const playerIndex = rawPlaceIdx as 0 | 1
      if (room.state.currentPlayer !== playerIndex) return
      const { x, y } = message
      const err = validateCueBallPlacement(x, y, playerIndex)
      if (err) { send(ws, { type: 'error', message: err }); return }
      placeCueBallBody(room, x, y)
      room.state.canPlaceCueBall = false
      room.state.foulPending = false
      clearTurnTimer(room)
      broadcastGameState(room)
      startTurnTimer(room)
    }
  })

  ws.on('close', () => {
    console.log('Client disconnected')
    const roomCode = playerRoom.get(ws)
    if (!roomCode) return
    const room = rooms.get(roomCode)
    if (room) {
      for (const player of room.players) {
        if (player !== ws) send(player, { type: 'opponent_disconnected' })
      }
    }
    cleanupRoom(roomCode)
  })
})
