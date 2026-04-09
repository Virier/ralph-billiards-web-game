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

// Server → Client messages
export type ServerMessage =
  | { type: 'room_created'; roomCode: string; playerId: string }
  | { type: 'room_joined'; roomCode: string; playerId: string }
  | { type: 'error'; message: string }
  | { type: 'start_game'; state: GameState; playerIndex: 0 | 1 }
  | { type: 'opponent_disconnected' }
  | { type: 'game_state'; state: GameState }
  | { type: 'game_over'; winner: 0 | 1 }
  | { type: 'turn_timeout' }

// Client → Server messages
export type ClientMessage =
  | { type: 'join_room'; roomCode: string }
  | { type: 'shoot'; dirX: number; dirY: number; power: number }
  | { type: 'place_cue_ball'; x: number; y: number }
