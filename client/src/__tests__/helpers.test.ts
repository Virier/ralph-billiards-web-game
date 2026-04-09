import { describe, it, expect } from 'vitest'
import type { GameState, PlayerGroup } from '../types'

// ─── Mirror the helper functions from App.tsx ─────────────────────────────────
// These are inlined here to avoid having to export them from App.tsx

function groupLabel(group: PlayerGroup): string {
  if (group === 'solid') return '纯色 ①–⑦'
  if (group === 'stripe') return '花色 ⑨–⑮'
  return '未定'
}

function remainingBalls(gameState: GameState, group: PlayerGroup): number | null {
  if (group === 'unassigned') return null
  const type = group === 'solid' ? 'solid' : 'stripe'
  return gameState.balls.filter((b) => b.type === type && !b.pocketed).length
}

// ─── Minimal test GameState factory ──────────────────────────────────────────

function makeGameState(overrides: Partial<GameState> = {}): GameState {
  return {
    balls: [],
    currentPlayer: 0,
    playerGroups: ['unassigned', 'unassigned'],
    phase: 'playing',
    ballsMoving: false,
    foulPending: false,
    canPlaceCueBall: false,
    winner: null,
    ...overrides,
  }
}

// ─── groupLabel ───────────────────────────────────────────────────────────────

describe('groupLabel', () => {
  it("returns '纯色 ①–⑦' for solid", () => {
    expect(groupLabel('solid')).toBe('纯色 ①–⑦')
  })

  it("returns '花色 ⑨–⑮' for stripe", () => {
    expect(groupLabel('stripe')).toBe('花色 ⑨–⑮')
  })

  it("returns '未定' for unassigned", () => {
    expect(groupLabel('unassigned')).toBe('未定')
  })
})

// ─── remainingBalls ───────────────────────────────────────────────────────────

describe('remainingBalls', () => {
  it('returns null for unassigned group', () => {
    const state = makeGameState()
    expect(remainingBalls(state, 'unassigned')).toBeNull()
  })

  it('counts non-pocketed solid balls', () => {
    const state = makeGameState({
      balls: [
        { id: 1, x: 0, y: 0, vx: 0, vy: 0, pocketed: false, type: 'solid' },
        { id: 2, x: 0, y: 0, vx: 0, vy: 0, pocketed: false, type: 'solid' },
        { id: 3, x: 0, y: 0, vx: 0, vy: 0, pocketed: true,  type: 'solid' },
        { id: 9, x: 0, y: 0, vx: 0, vy: 0, pocketed: false, type: 'stripe' },
      ],
    })
    expect(remainingBalls(state, 'solid')).toBe(2)
  })

  it('counts non-pocketed stripe balls', () => {
    const state = makeGameState({
      balls: [
        { id: 9,  x: 0, y: 0, vx: 0, vy: 0, pocketed: false, type: 'stripe' },
        { id: 10, x: 0, y: 0, vx: 0, vy: 0, pocketed: true,  type: 'stripe' },
        { id: 11, x: 0, y: 0, vx: 0, vy: 0, pocketed: false, type: 'stripe' },
        { id: 1,  x: 0, y: 0, vx: 0, vy: 0, pocketed: false, type: 'solid' },
      ],
    })
    expect(remainingBalls(state, 'stripe')).toBe(2)
  })

  it('returns 0 when all balls of the group are pocketed', () => {
    const state = makeGameState({
      balls: [
        { id: 1, x: 0, y: 0, vx: 0, vy: 0, pocketed: true, type: 'solid' },
        { id: 2, x: 0, y: 0, vx: 0, vy: 0, pocketed: true, type: 'solid' },
      ],
    })
    expect(remainingBalls(state, 'solid')).toBe(0)
  })

  it('returns 7 at game start for solid group (full set)', () => {
    const balls = Array.from({ length: 7 }, (_, i) => ({
      id: i + 1, x: 0, y: 0, vx: 0, vy: 0, pocketed: false, type: 'solid' as const,
    }))
    const state = makeGameState({ balls })
    expect(remainingBalls(state, 'solid')).toBe(7)
  })
})
