import { WebSocketServer, WebSocket } from 'ws'
import { randomUUID } from 'crypto'
import Matter from 'matter-js'

const { Engine, World, Bodies, Body, Events } = Matter

const PORT = 8080

// Table dimensions (must match client constants)
const TABLE_WIDTH = 1400
const TABLE_HEIGHT = 700
const BALL_RADIUS = 14
const RAIL_WIDTH = 44

// Physics-visible pocket positions (at the inner edge of the playing surface)
const POCKET_RADIUS = 22
const POCKET_DETECTION_RADIUS = POCKET_RADIUS + BALL_RADIUS // ball center within this → pocketed
const WALL_THICKNESS = 20
const POCKET_GAP = POCKET_RADIUS + BALL_RADIUS + 4 // gap in wall at each pocket

// Playing surface boundaries
const PLAY_LEFT = RAIL_WIDTH
const PLAY_RIGHT = TABLE_WIDTH - RAIL_WIDTH
const PLAY_TOP = RAIL_WIDTH
const PLAY_BOTTOM = TABLE_HEIGHT - RAIL_WIDTH

// Pocket positions (on the playing surface edge)
const POCKET_POSITIONS = [
  { x: PLAY_LEFT, y: PLAY_TOP },                // top-left corner
  { x: PLAY_RIGHT, y: PLAY_TOP },               // top-right corner
  { x: PLAY_LEFT, y: PLAY_BOTTOM },             // bottom-left corner
  { x: PLAY_RIGHT, y: PLAY_BOTTOM },            // bottom-right corner
  { x: TABLE_WIDTH / 2, y: PLAY_TOP },          // top-center side
  { x: TABLE_WIDTH / 2, y: PLAY_BOTTOM },       // bottom-center side
]

const VELOCITY_THRESHOLD = 0.5 // below this = considered stopped
const PHYSICS_FPS = 60
const PHYSICS_DT = 1000 / PHYSICS_FPS

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

interface PhysicsState {
  engine: Matter.Engine
  ballBodies: Map<number, Matter.Body> // ball id → Matter body
  intervalId: ReturnType<typeof setInterval> | null
}

interface Room {
  code: string
  players: WebSocket[]
  playerIds: string[]
  state: GameState | null
  physics: PhysicsState | null
  ballsPocketedThisTurn: number[] // ball IDs pocketed this shot, in order
  shooterThisTurn: 0 | 1 | null  // which player fired the current shot
  cueBallFirstContact: number | null  // ID of first ball the cue ball hit this shot
  cueBallPocketedThisTurn: boolean    // whether cue ball was pocketed this shot
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

  // Standard Chinese 8-ball triangle rack
  const rackRows: number[][] = [
    [1],
    [9, 2],
    [3, 8, 10],
    [4, 11, 5, 12],
    [6, 13, 7, 14, 15],
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

/**
 * Create wall segments for one axis, leaving gaps at pocket positions.
 * Returns an array of { start, end } segments.
 */
function wallSegments(
  from: number,
  to: number,
  pocketCenters: number[],
): Array<[number, number]> {
  // Sort pocket positions, build gaps
  const gaps: Array<[number, number]> = pocketCenters.map((c) => [
    c - POCKET_GAP,
    c + POCKET_GAP,
  ])
  gaps.sort((a, b) => a[0] - b[0])

  const segments: Array<[number, number]> = []
  let cursor = from
  for (const [gStart, gEnd] of gaps) {
    if (gStart > cursor) {
      segments.push([cursor, gStart])
    }
    cursor = Math.max(cursor, gEnd)
  }
  if (cursor < to) {
    segments.push([cursor, to])
  }
  return segments
}

function createWalls(): Matter.Body[] {
  const walls: Matter.Body[] = []
  const wallOptions = {
    isStatic: true,
    restitution: 0.65,
    friction: 0.05,
    frictionAir: 0,
    label: 'wall',
  }

  // Top wall segments (y = PLAY_TOP)
  const topPocketX = [PLAY_LEFT, TABLE_WIDTH / 2, PLAY_RIGHT]
  for (const [s, e] of wallSegments(PLAY_LEFT, PLAY_RIGHT, topPocketX)) {
    const w = e - s
    walls.push(Bodies.rectangle(s + w / 2, PLAY_TOP - WALL_THICKNESS / 2, w, WALL_THICKNESS, wallOptions))
  }

  // Bottom wall segments (y = PLAY_BOTTOM)
  const bottomPocketX = [PLAY_LEFT, TABLE_WIDTH / 2, PLAY_RIGHT]
  for (const [s, e] of wallSegments(PLAY_LEFT, PLAY_RIGHT, bottomPocketX)) {
    const w = e - s
    walls.push(Bodies.rectangle(s + w / 2, PLAY_BOTTOM + WALL_THICKNESS / 2, w, WALL_THICKNESS, wallOptions))
  }

  // Left wall (x = PLAY_LEFT)
  const leftPocketY = [PLAY_TOP, PLAY_BOTTOM]
  for (const [s, e] of wallSegments(PLAY_TOP, PLAY_BOTTOM, leftPocketY)) {
    const h = e - s
    walls.push(Bodies.rectangle(PLAY_LEFT - WALL_THICKNESS / 2, s + h / 2, WALL_THICKNESS, h, wallOptions))
  }

  // Right wall (x = PLAY_RIGHT)
  const rightPocketY = [PLAY_TOP, PLAY_BOTTOM]
  for (const [s, e] of wallSegments(PLAY_TOP, PLAY_BOTTOM, rightPocketY)) {
    const h = e - s
    walls.push(Bodies.rectangle(PLAY_RIGHT + WALL_THICKNESS / 2, s + h / 2, WALL_THICKNESS, h, wallOptions))
  }

  return walls
}

function initPhysics(state: GameState): PhysicsState {
  const engine = Engine.create({
    gravity: { x: 0, y: 0, scale: 0 }, // top-down, no gravity
  })

  const ballBodies = new Map<number, Matter.Body>()

  // Create ball bodies
  for (const ball of state.balls) {
    if (!ball.pocketed) {
      const body = Bodies.circle(ball.x, ball.y, BALL_RADIUS, {
        restitution: 0.85,
        friction: 0.005,
        frictionAir: 0.015,
        density: 0.002,
        label: `ball_${ball.id}`,
      })
      ballBodies.set(ball.id, body)
      World.add(engine.world, body)
    }
  }

  // Create walls
  const walls = createWalls()
  World.add(engine.world, walls)

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

/** Returns ball IDs that were pocketed this frame, in the order they appear in state.balls */
function checkPocketed(state: GameState, physics: PhysicsState): number[] {
  const newlyPocketed: number[] = []
  for (const ball of state.balls) {
    if (ball.pocketed) continue
    const body = physics.ballBodies.get(ball.id)
    if (!body) continue

    for (const pocket of POCKET_POSITIONS) {
      const dx = body.position.x - pocket.x
      const dy = body.position.y - pocket.y
      const dist = Math.sqrt(dx * dx + dy * dy)
      if (dist < POCKET_DETECTION_RADIUS) {
        // Ball is pocketed
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

function allBallsStopped(state: GameState): boolean {
  for (const ball of state.balls) {
    if (ball.pocketed) continue
    const speed = Math.sqrt(ball.vx * ball.vx + ball.vy * ball.vy)
    if (speed >= VELOCITY_THRESHOLD) return false
  }
  return true
}

function broadcastGameState(room: Room): void {
  if (!room.state) return
  const msg: ServerMessage = { type: 'game_state', state: room.state }
  const json = JSON.stringify(msg)
  for (const player of room.players) {
    if (player.readyState === WebSocket.OPEN) {
      player.send(json)
    }
  }
}

function broadcastGameOver(room: Room, winner: 0 | 1): void {
  const msg: ServerMessage = { type: 'game_over', winner }
  const json = JSON.stringify(msg)
  for (const player of room.players) {
    if (player.readyState === WebSocket.OPEN) {
      player.send(json)
    }
  }
}

/**
 * Assigns ball groups after the first non-black-8 ball is pocketed.
 * shooter gets the group matching the first pocketed ball's type;
 * opponent gets the other group.
 */
function assignGroupsIfNeeded(
  state: GameState,
  ballsPocketed: number[],
  shooter: 0 | 1,
): void {
  if (state.playerGroups[0] !== 'unassigned') return // already assigned
  for (const ballId of ballsPocketed) {
    const ball = state.balls.find((b) => b.id === ballId)
    if (!ball || ball.type === 'cue' || ball.type === 'black') continue
    // First non-black, non-cue ball determines the groups
    const shooterGroup: PlayerGroup = ball.type === 'solid' ? 'solid' : 'stripe'
    const opponentGroup: PlayerGroup = shooterGroup === 'solid' ? 'stripe' : 'solid'
    state.playerGroups[shooter] = shooterGroup
    state.playerGroups[1 - shooter] = opponentGroup
    return
  }
}

/** Called when all balls come to rest after a shot */
function handleTurnEnd(room: Room): void {
  if (!room.state) return
  const state = room.state
  const shooter = room.shooterThisTurn

  if (shooter !== null) {
    // Assign groups if not yet assigned (must happen before foul check)
    assignGroupsIfNeeded(state, room.ballsPocketedThisTurn, shooter)
  }

  // ── Win/loss detection: black 8 pocketed ──────────────────────────────────
  if (shooter !== null && room.ballsPocketedThisTurn.includes(8)) {
    const opponent = (1 - shooter) as 0 | 1
    let winner: 0 | 1

    if (room.cueBallPocketedThisTurn) {
      // Cue ball and black 8 both pocketed → shooter loses
      winner = opponent
    } else {
      const shooterGroup = state.playerGroups[shooter]
      if (shooterGroup === 'unassigned') {
        // Groups not yet determined (8 on break) → shooter loses
        winner = opponent
      } else {
        // Check if shooter has cleared all their group balls
        const remaining = state.balls.filter(
          (b) => b.type === shooterGroup && !b.pocketed,
        )
        winner = remaining.length === 0 ? shooter : opponent
      }
    }

    // Finalise game state
    state.phase = 'game_over'
    state.winner = winner
    state.ballsMoving = false

    // Reset per-turn tracking before exiting
    room.ballsPocketedThisTurn = []
    room.shooterThisTurn = null
    room.cueBallFirstContact = null
    room.cueBallPocketedThisTurn = false

    broadcastGameState(room)
    broadcastGameOver(room, winner)
    stopPhysicsLoop(room)
    return
  }
  // ─────────────────────────────────────────────────────────────────────────

  // Detect foul
  let isFoul = false
  if (shooter !== null) {
    // Foul type 1: cue ball pocketed
    if (room.cueBallPocketedThisTurn) {
      isFoul = true
    }

    // Foul type 2: groups assigned and cue ball didn't hit own group first
    if (!isFoul && state.playerGroups[shooter] !== 'unassigned') {
      const firstContact = room.cueBallFirstContact
      if (firstContact === null) {
        // No contact at all — foul (missed entirely)
        isFoul = true
      } else {
        const firstBall = state.balls.find((b) => b.id === firstContact)
        if (firstBall) {
          const shooterGroup = state.playerGroups[shooter]
          // Must hit own group first (stripe/solid type must match group)
          if (firstBall.type !== shooterGroup) {
            isFoul = true
          }
        }
      }
    }
  }

  // Reset per-turn tracking
  room.ballsPocketedThisTurn = []
  room.shooterThisTurn = null
  room.cueBallFirstContact = null
  room.cueBallPocketedThisTurn = false

  // Switch turns; grant ball-in-hand on foul
  state.currentPlayer = state.currentPlayer === 0 ? 1 : 0
  if (isFoul) {
    state.foulPending = true
    state.canPlaceCueBall = true
  } else {
    state.foulPending = false
    state.canPlaceCueBall = false
  }
}

function startPhysicsLoop(room: Room): void {
  if (!room.state || !room.physics) return
  const physics = room.physics
  const state = room.state

  // Track first cue ball contact with another ball (for foul detection)
  Events.on(physics.engine, 'collisionStart', (event) => {
    if (room.cueBallFirstContact !== null) return // already recorded first contact
    if (!state.ballsMoving) return                // only track during active shot
    for (const pair of event.pairs) {
      const { bodyA, bodyB } = pair
      const isCueA = bodyA.label === 'ball_0'
      const isCueB = bodyB.label === 'ball_0'
      if (!isCueA && !isCueB) continue
      const otherBody = isCueA ? bodyB : bodyA
      if (!otherBody.label.startsWith('ball_')) continue // ignore wall contacts
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
      if (newlyPocketed.includes(0)) {
        room.cueBallPocketedThisTurn = true
      }
    }

    const wasMoved = state.ballsMoving
    state.ballsMoving = !allBallsStopped(state)

    // When balls just came to rest, handle turn end logic
    if (wasMoved && !state.ballsMoving) {
      handleTurnEnd(room)
    }

    // Broadcast every frame while balls are moving, or once when they stop
    if (state.ballsMoving || wasMoved) {
      broadcastGameState(room)
    }
  }, PHYSICS_DT)
}

function stopPhysicsLoop(room: Room): void {
  if (room.physics?.intervalId) {
    clearInterval(room.physics.intervalId)
    room.physics.intervalId = null
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
  stopPhysicsLoop(room)
  for (const player of room.players) {
    playerRoom.delete(player)
  }
  rooms.delete(roomCode)
}

const MAX_SHOOT_POWER = 0.08 // scales power% (0-100) to Matter.js impulse magnitude

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
          physics: null,
          ballsPocketedThisTurn: [],
          shooterThisTurn: null,
          cueBallFirstContact: null,
          cueBallPocketedThisTurn: false,
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
        room.physics = initPhysics(state)

        send(room.players[0], { type: 'start_game', state, playerIndex: 0 })
        send(room.players[1], { type: 'start_game', state, playerIndex: 1 })

        // Start physics loop
        startPhysicsLoop(room)
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

      // Cannot shoot while ball-in-hand placement is pending
      if (room.state.canPlaceCueBall) return

      const cueBall = room.state.balls.find((b) => b.id === 0)
      if (!cueBall || cueBall.pocketed) return

      const cueBallBody = room.physics.ballBodies.get(0)
      if (!cueBallBody) return

      const power = Math.max(0, Math.min(100, message.power)) / 100
      const forceMagnitude = power * MAX_SHOOT_POWER
      const len = Math.sqrt(message.dirX * message.dirX + message.dirY * message.dirY)
      if (len === 0) return
      const fx = (message.dirX / len) * forceMagnitude
      const fy = (message.dirY / len) * forceMagnitude

      Body.applyForce(cueBallBody, cueBallBody.position, { x: fx, y: fy })
      room.state.ballsMoving = true
      // Track shooter and reset per-turn tracking
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

      // Validate placement is within table bounds
      const { x, y } = message
      const margin = BALL_RADIUS + 2
      if (
        x < PLAY_LEFT + margin ||
        x > PLAY_RIGHT - margin ||
        y < PLAY_TOP + margin ||
        y > PLAY_BOTTOM - margin
      ) {
        send(ws, { type: 'error', message: '白球只能放在台面内' })
        return
      }

      // Validate half-court restriction: player 0 → left half; player 1 → right half
      const halfX = TABLE_WIDTH / 2
      if (playerIndex === 0 && x > halfX) {
        send(ws, { type: 'error', message: '白球只能放在己方底线半场内' })
        return
      }
      if (playerIndex === 1 && x < halfX) {
        send(ws, { type: 'error', message: '白球只能放在己方底线半场内' })
        return
      }

      // Re-create the cue ball body
      const cueBall = room.state.balls.find((b) => b.id === 0)
      if (!cueBall) return

      // Remove old body if it exists
      const oldBody = room.physics.ballBodies.get(0)
      if (oldBody) {
        World.remove(room.physics.engine.world, oldBody)
      }

      cueBall.x = x
      cueBall.y = y
      cueBall.vx = 0
      cueBall.vy = 0
      cueBall.pocketed = false

      const newBody = Bodies.circle(x, y, BALL_RADIUS, {
        restitution: 0.85,
        friction: 0.005,
        frictionAir: 0.015,
        density: 0.002,
        label: 'ball_0',
      })
      room.physics.ballBodies.set(0, newBody)
      World.add(room.physics.engine.world, newBody)

      room.state.canPlaceCueBall = false
      room.state.foulPending = false
      broadcastGameState(room)
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
