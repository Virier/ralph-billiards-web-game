// ─── Constants ────────────────────────────────────────────────────────────────

export const TABLE_WIDTH = 1400
export const TABLE_HEIGHT = 700
export const BALL_RADIUS = 14
export const RAIL_WIDTH = 44
export const POCKET_RADIUS = 22
export const PLAY_LEFT = RAIL_WIDTH
export const PLAY_RIGHT = TABLE_WIDTH - RAIL_WIDTH
export const PLAY_TOP = RAIL_WIDTH
export const PLAY_BOTTOM = TABLE_HEIGHT - RAIL_WIDTH
export const VELOCITY_THRESHOLD = 0.5
export const MAX_SHOOT_POWER = 0.08

// ─── Types ────────────────────────────────────────────────────────────────────

export type BallType = 'solid' | 'stripe' | 'black' | 'cue'
export type PlayerGroup = 'unassigned' | 'solid' | 'stripe'

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

// ─── Pure game-logic functions ────────────────────────────────────────────────

export function createInitialGameState(): GameState {
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

export function allBallsStopped(state: GameState): boolean {
  for (const ball of state.balls) {
    if (ball.pocketed) continue
    const speed = Math.sqrt(ball.vx * ball.vx + ball.vy * ball.vy)
    if (speed >= VELOCITY_THRESHOLD) return false
  }
  return true
}

/**
 * Assigns ball groups after the first non-black-8 ball is pocketed.
 * Mutates state.playerGroups in place.
 */
export function assignGroupsIfNeeded(
  state: GameState,
  ballsPocketed: number[],
  shooter: 0 | 1,
): void {
  if (state.playerGroups[0] !== 'unassigned') return // already assigned
  for (const ballId of ballsPocketed) {
    const ball = state.balls.find((b) => b.id === ballId)
    if (!ball || ball.type === 'cue' || ball.type === 'black') continue
    const shooterGroup: PlayerGroup = ball.type === 'solid' ? 'solid' : 'stripe'
    const opponentGroup: PlayerGroup = shooterGroup === 'solid' ? 'stripe' : 'solid'
    state.playerGroups[shooter] = shooterGroup
    state.playerGroups[1 - shooter] = opponentGroup
    return
  }
}

/**
 * Evaluates the outcome of a turn after all balls have stopped.
 * Returns pure state describing what happened — no side effects.
 */
export interface TurnResult {
  gameOver: boolean
  winner?: 0 | 1
  isFoul: boolean
  keepTurn: boolean
}

export function evaluateTurnEnd(
  state: GameState,
  shooter: 0 | 1 | null,
  ballsPocketedThisTurn: number[],
  cueBallPocketedThisTurn: boolean,
  cueBallFirstContact: number | null,
): TurnResult {
  // ── 0. Record break phase before group assignment ────────────────────────
  const wasBreakPhase =
    state.playerGroups[0] === 'unassigned' && state.playerGroups[1] === 'unassigned'

  // ── 1. Assign groups if needed (mutates state) ───────────────────────────
  if (shooter !== null) {
    assignGroupsIfNeeded(state, ballsPocketedThisTurn, shooter)
  }

  // ── 2. Win/loss detection: black 8 pocketed ──────────────────────────────
  if (shooter !== null && ballsPocketedThisTurn.includes(8)) {
    const opponent = (1 - shooter) as 0 | 1
    let winner: 0 | 1

    if (cueBallPocketedThisTurn) {
      winner = opponent
    } else {
      const shooterGroup = state.playerGroups[shooter]
      if (shooterGroup === 'unassigned') {
        winner = opponent
      } else {
        const remaining = state.balls.filter(
          (b) => b.type === shooterGroup && !b.pocketed,
        )
        winner = remaining.length === 0 ? shooter : opponent
      }
    }

    // Illegal 8-ball pocket (own group balls remaining, or cue ball pocketed) is a foul
    const illegalBlack =
      cueBallPocketedThisTurn ||
      (state.playerGroups[shooter] !== 'unassigned' &&
        state.balls.filter((b) => b.type === state.playerGroups[shooter] && !b.pocketed).length > 0)
    return { gameOver: true, winner, isFoul: illegalBlack, keepTurn: false }
  }

  // ── 3. Foul detection ────────────────────────────────────────────────────
  let isFoul = false
  if (shooter !== null) {
    if (cueBallPocketedThisTurn) {
      isFoul = true
    }

    if (!isFoul && state.playerGroups[shooter] !== 'unassigned') {
      if (cueBallFirstContact === null) {
        isFoul = true
      } else {
        const firstBall = state.balls.find((b) => b.id === cueBallFirstContact)
        if (firstBall) {
          if (firstBall.type === 'black') {
            // Legal to shoot black 8 only when all own group balls are pocketed
            const myRemainingGroupBalls = state.balls.filter(
              (b) => b.type === state.playerGroups[shooter] && !b.pocketed,
            )
            if (myRemainingGroupBalls.length > 0) {
              isFoul = true
            }
          } else if (firstBall.type !== state.playerGroups[shooter]) {
            isFoul = true
          }
        }
      }
    }
  }

  // ── 4. keepTurn calculation ──────────────────────────────────────────────
  let keepTurn = false
  if (!isFoul && shooter !== null) {
    if (wasBreakPhase) {
      // Break phase: keep turn if at least one non-cue non-black ball pocketed
      keepTurn = ballsPocketedThisTurn.some((id) => {
        const ball = state.balls.find((b) => b.id === id)
        return ball && ball.type !== 'cue' && ball.type !== 'black'
      })
    } else {
      // Regular play: keep turn if at least one own-group ball pocketed
      const shooterGroup = state.playerGroups[shooter]
      if (shooterGroup !== 'unassigned') {
        keepTurn = ballsPocketedThisTurn.some((id) => {
          const ball = state.balls.find((b) => b.id === id)
          return ball && ball.type === shooterGroup
        })
      }
    }
  }

  return { gameOver: false, isFoul, keepTurn }
}

/**
 * Validates placement of the cue ball during ball-in-hand.
 * Returns an error string if invalid, or null if valid.
 */
export function validateCueBallPlacement(
  x: number,
  y: number,
  playerIndex: 0 | 1,
): string | null {
  const margin = BALL_RADIUS + 2
  if (
    x < PLAY_LEFT + margin ||
    x > PLAY_RIGHT - margin ||
    y < PLAY_TOP + margin ||
    y > PLAY_BOTTOM - margin
  ) {
    return '白球只能放在台面内'
  }

  const halfX = TABLE_WIDTH / 2
  if (playerIndex === 0 && x > halfX) return '白球只能放在己方底线半场内'
  if (playerIndex === 1 && x < halfX) return '白球只能放在己方底线半场内'

  return null
}
