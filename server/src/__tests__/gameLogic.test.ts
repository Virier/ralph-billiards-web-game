import { describe, it, expect, beforeEach } from 'vitest'
import {
  TABLE_WIDTH, TABLE_HEIGHT, BALL_RADIUS, PLAY_LEFT, PLAY_RIGHT, PLAY_TOP, PLAY_BOTTOM,
  createInitialGameState,
  allBallsStopped,
  assignGroupsIfNeeded,
  evaluateTurnEnd,
  validateCueBallPlacement,
} from '../gameLogic.js'
import type { GameState, Ball } from '../gameLogic.js'

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeState(overrides: Partial<GameState> = {}): GameState {
  return {
    ...createInitialGameState(),
    ...overrides,
  }
}

/** Return a copy of state with specific balls pocketed */
function pocketBall(state: GameState, id: number): GameState {
  return {
    ...state,
    balls: state.balls.map((b) => (b.id === id ? { ...b, pocketed: true } : b)),
  }
}

// ─── createInitialGameState ───────────────────────────────────────────────────

describe('createInitialGameState', () => {
  it('creates exactly 16 balls (IDs 0–15)', () => {
    const state = createInitialGameState()
    expect(state.balls).toHaveLength(16)
    const ids = state.balls.map((b) => b.id).sort((a, z) => a - z)
    expect(ids).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15])
  })

  it('places cue ball at TABLE_WIDTH*0.25, TABLE_HEIGHT/2', () => {
    const state = createInitialGameState()
    const cue = state.balls.find((b) => b.id === 0)!
    expect(cue.x).toBeCloseTo(TABLE_WIDTH * 0.25)
    expect(cue.y).toBeCloseTo(TABLE_HEIGHT / 2)
    expect(cue.type).toBe('cue')
  })

  it('has solid balls for IDs 1–7', () => {
    const state = createInitialGameState()
    for (let i = 1; i <= 7; i++) {
      expect(state.balls.find((b) => b.id === i)?.type).toBe('solid')
    }
  })

  it('has black ball for ID 8', () => {
    const state = createInitialGameState()
    expect(state.balls.find((b) => b.id === 8)?.type).toBe('black')
  })

  it('has stripe balls for IDs 9–15', () => {
    const state = createInitialGameState()
    for (let i = 9; i <= 15; i++) {
      expect(state.balls.find((b) => b.id === i)?.type).toBe('stripe')
    }
  })

  it('starts with currentPlayer 0, unassigned groups, playing phase', () => {
    const state = createInitialGameState()
    expect(state.currentPlayer).toBe(0)
    expect(state.playerGroups).toEqual(['unassigned', 'unassigned'])
    expect(state.phase).toBe('playing')
    expect(state.ballsMoving).toBe(false)
    expect(state.canPlaceCueBall).toBe(false)
    expect(state.foulPending).toBe(false)
    expect(state.winner).toBeNull()
  })

  it('all balls start with zero velocity and not pocketed', () => {
    const state = createInitialGameState()
    for (const ball of state.balls) {
      expect(ball.vx).toBe(0)
      expect(ball.vy).toBe(0)
      expect(ball.pocketed).toBe(false)
    }
  })
})

// ─── allBallsStopped ──────────────────────────────────────────────────────────

describe('allBallsStopped', () => {
  it('returns true when all balls have zero velocity', () => {
    expect(allBallsStopped(createInitialGameState())).toBe(true)
  })

  it('returns false when any ball exceeds velocity threshold', () => {
    const state = createInitialGameState()
    state.balls[1].vx = 2.0
    expect(allBallsStopped(state)).toBe(false)
  })

  it('ignores pocketed balls', () => {
    const state = createInitialGameState()
    state.balls[1].vx = 5.0
    state.balls[1].pocketed = true
    expect(allBallsStopped(state)).toBe(true)
  })

  it('returns false when speed equals threshold (0.5)', () => {
    const state = createInitialGameState()
    state.balls[0].vx = 0.5
    expect(allBallsStopped(state)).toBe(false)
  })

  it('returns true when speed is just below threshold (0.49)', () => {
    const state = createInitialGameState()
    state.balls[0].vx = 0.49
    expect(allBallsStopped(state)).toBe(true)
  })
})

// ─── assignGroupsIfNeeded ─────────────────────────────────────────────────────

describe('assignGroupsIfNeeded', () => {
  it('assigns solid to shooter when a solid ball is pocketed first', () => {
    const state = createInitialGameState()
    assignGroupsIfNeeded(state, [1], 0)
    expect(state.playerGroups[0]).toBe('solid')
    expect(state.playerGroups[1]).toBe('stripe')
  })

  it('assigns stripe to shooter when a stripe ball is pocketed first', () => {
    const state = createInitialGameState()
    assignGroupsIfNeeded(state, [9], 0)
    expect(state.playerGroups[0]).toBe('stripe')
    expect(state.playerGroups[1]).toBe('solid')
  })

  it('assigns to player 1 correctly', () => {
    const state = createInitialGameState()
    assignGroupsIfNeeded(state, [3], 1)
    expect(state.playerGroups[1]).toBe('solid')
    expect(state.playerGroups[0]).toBe('stripe')
  })

  it('skips cue ball (id=0) in pocketed list', () => {
    const state = createInitialGameState()
    assignGroupsIfNeeded(state, [0], 0)
    expect(state.playerGroups[0]).toBe('unassigned')
    expect(state.playerGroups[1]).toBe('unassigned')
  })

  it('skips black ball (id=8) in pocketed list', () => {
    const state = createInitialGameState()
    assignGroupsIfNeeded(state, [8], 0)
    expect(state.playerGroups[0]).toBe('unassigned')
    expect(state.playerGroups[1]).toBe('unassigned')
  })

  it('uses first non-cue, non-black ball when multiple balls pocketed', () => {
    const state = createInitialGameState()
    // cue first, then solid, then stripe — should use solid
    assignGroupsIfNeeded(state, [0, 1, 9], 0)
    expect(state.playerGroups[0]).toBe('solid')
  })

  it('does nothing if groups already assigned', () => {
    const state = createInitialGameState()
    state.playerGroups[0] = 'solid'
    state.playerGroups[1] = 'stripe'
    assignGroupsIfNeeded(state, [9], 0)
    expect(state.playerGroups[0]).toBe('solid') // unchanged
    expect(state.playerGroups[1]).toBe('stripe')
  })

  it('does nothing when pocketed list is empty', () => {
    const state = createInitialGameState()
    assignGroupsIfNeeded(state, [], 0)
    expect(state.playerGroups[0]).toBe('unassigned')
  })
})

// ─── evaluateTurnEnd ──────────────────────────────────────────────────────────

describe('evaluateTurnEnd — normal turn (no foul, no game over)', () => {
  it('returns isFoul=false, gameOver=false when no balls pocketed and groups unassigned', () => {
    const state = createInitialGameState()
    // Groups unassigned → no foul check on first contact
    const result = evaluateTurnEnd(state, 0, [], false, 1)
    expect(result.isFoul).toBe(false)
    expect(result.gameOver).toBe(false)
  })

  it('returns isFoul=false when player hits own group ball first', () => {
    const state = createInitialGameState()
    state.playerGroups[0] = 'solid'
    state.playerGroups[1] = 'stripe'
    // First contact was ball 1 (solid) — same as shooter's group
    const result = evaluateTurnEnd(state, 0, [], false, 1)
    expect(result.isFoul).toBe(false)
    expect(result.gameOver).toBe(false)
  })
})

describe('evaluateTurnEnd — foul detection', () => {
  it('foul when cue ball is pocketed', () => {
    const state = createInitialGameState()
    const result = evaluateTurnEnd(state, 0, [0], true, null)
    expect(result.isFoul).toBe(true)
    expect(result.gameOver).toBe(false)
  })

  it('foul when groups assigned but cue ball missed everything (no contact)', () => {
    const state = createInitialGameState()
    state.playerGroups[0] = 'solid'
    state.playerGroups[1] = 'stripe'
    const result = evaluateTurnEnd(state, 0, [], false, null)
    expect(result.isFoul).toBe(true)
  })

  it('foul when player hits opponent group ball first', () => {
    const state = createInitialGameState()
    state.playerGroups[0] = 'solid'
    state.playerGroups[1] = 'stripe'
    // First contact was ball 9 (stripe) — wrong group for shooter 0
    const result = evaluateTurnEnd(state, 0, [], false, 9)
    expect(result.isFoul).toBe(true)
  })

  it('no foul when groups unassigned even if contact is any ball', () => {
    const state = createInitialGameState()
    // Break shot — groups not yet assigned
    const result = evaluateTurnEnd(state, 0, [], false, 9)
    expect(result.isFoul).toBe(false)
  })

  it('no foul for null shooter (turn timeout with no shot)', () => {
    const state = createInitialGameState()
    const result = evaluateTurnEnd(state, null, [], false, null)
    expect(result.isFoul).toBe(false)
    expect(result.gameOver).toBe(false)
  })
})

describe('evaluateTurnEnd — win/loss detection', () => {
  it('shooter wins when 8-ball pocketed and own group cleared', () => {
    let state = createInitialGameState()
    // Pocket all solid balls (1–7)
    for (let i = 1; i <= 7; i++) state = pocketBall(state, i)
    state.playerGroups[0] = 'solid'
    state.playerGroups[1] = 'stripe'
    // Also mark ball 8 as pocketed in the state (it's still in balls array)
    state = pocketBall(state, 8)
    const result = evaluateTurnEnd(state, 0, [8], false, 1)
    expect(result.gameOver).toBe(true)
    expect(result.winner).toBe(0)
  })

  it('shooter loses when 8-ball pocketed but own group not cleared', () => {
    const state = createInitialGameState()
    state.playerGroups[0] = 'solid'
    state.playerGroups[1] = 'stripe'
    // Solid balls (1–7) are NOT pocketed — shooter loses
    const result = evaluateTurnEnd(state, 0, [8], false, 1)
    expect(result.gameOver).toBe(true)
    expect(result.winner).toBe(1)
  })

  it('shooter loses when 8-ball + cue ball both pocketed', () => {
    let state = createInitialGameState()
    for (let i = 1; i <= 7; i++) state = pocketBall(state, i)
    state.playerGroups[0] = 'solid'
    state.playerGroups[1] = 'stripe'
    const result = evaluateTurnEnd(state, 0, [0, 8], true, null)
    expect(result.gameOver).toBe(true)
    expect(result.winner).toBe(1) // opponent wins
  })

  it('shooter loses when 8-ball pocketed on break (groups unassigned)', () => {
    const state = createInitialGameState()
    const result = evaluateTurnEnd(state, 0, [8], false, null)
    expect(result.gameOver).toBe(true)
    expect(result.winner).toBe(1)
  })

  it('player 1 can win by pocketing 8-ball after clearing stripes', () => {
    let state = createInitialGameState()
    for (let i = 9; i <= 15; i++) state = pocketBall(state, i)
    state.playerGroups[0] = 'solid'
    state.playerGroups[1] = 'stripe'
    state = pocketBall(state, 8)
    const result = evaluateTurnEnd(state, 1, [8], false, 10)
    expect(result.gameOver).toBe(true)
    expect(result.winner).toBe(1)
  })
})

describe('evaluateTurnEnd — group assignment side effect', () => {
  it('assigns groups when first ball pocketed this turn', () => {
    const state = createInitialGameState()
    evaluateTurnEnd(state, 0, [1], false, 1)
    expect(state.playerGroups[0]).toBe('solid')
    expect(state.playerGroups[1]).toBe('stripe')
  })
})

// ─── validateCueBallPlacement ─────────────────────────────────────────────────

describe('validateCueBallPlacement', () => {
  const safeX0 = PLAY_LEFT + BALL_RADIUS + 10   // Player 0 valid x (left half)
  const safeX1 = TABLE_WIDTH / 2 + BALL_RADIUS + 10 // Player 1 valid x (right half)
  const safeY = TABLE_HEIGHT / 2

  it('accepts valid position for player 0 (left half)', () => {
    expect(validateCueBallPlacement(safeX0, safeY, 0)).toBeNull()
  })

  it('accepts valid position for player 1 (right half)', () => {
    expect(validateCueBallPlacement(safeX1, safeY, 1)).toBeNull()
  })

  it('rejects position outside table bounds', () => {
    expect(validateCueBallPlacement(0, safeY, 0)).not.toBeNull()
    expect(validateCueBallPlacement(TABLE_WIDTH, safeY, 0)).not.toBeNull()
  })

  it('rejects player 0 placing in right half', () => {
    const rightX = TABLE_WIDTH * 0.75
    expect(validateCueBallPlacement(rightX, safeY, 0)).not.toBeNull()
  })

  it('rejects player 1 placing in left half', () => {
    const leftX = TABLE_WIDTH * 0.25
    expect(validateCueBallPlacement(leftX, safeY, 1)).not.toBeNull()
  })

  it('rejects position too close to rail (top)', () => {
    expect(validateCueBallPlacement(safeX0, PLAY_TOP, 0)).not.toBeNull()
  })

  it('rejects position too close to rail (bottom)', () => {
    expect(validateCueBallPlacement(safeX0, PLAY_BOTTOM, 0)).not.toBeNull()
  })
})
