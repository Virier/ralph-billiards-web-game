import { useEffect, useRef, useState, useCallback } from 'react'
import type { Ball, GameState } from './types'

export const TABLE_WIDTH = 1400
export const TABLE_HEIGHT = 700
export const BALL_RADIUS = 14

const RAIL_WIDTH = 44
const POCKET_RADIUS = 22
const MAX_DRAG = 150 // canvas pixels = 100% power

// Colors for balls 1-15 (9-15 share colors with 1-7 as stripes)
const BALL_COLORS: Record<number, string> = {
  1: '#f5d020',
  2: '#1a56db',
  3: '#e02424',
  4: '#7e22ce',
  5: '#f97316',
  6: '#16a34a',
  7: '#991b1b',
  8: '#1a1a1a',
  9: '#f5d020',
  10: '#1a56db',
  11: '#e02424',
  12: '#7e22ce',
  13: '#f97316',
  14: '#16a34a',
  15: '#991b1b',
}

const POCKET_POSITIONS = [
  // Corner pockets (at the inner edges of the rails)
  { x: RAIL_WIDTH, y: RAIL_WIDTH },
  { x: TABLE_WIDTH - RAIL_WIDTH, y: RAIL_WIDTH },
  { x: RAIL_WIDTH, y: TABLE_HEIGHT - RAIL_WIDTH },
  { x: TABLE_WIDTH - RAIL_WIDTH, y: TABLE_HEIGHT - RAIL_WIDTH },
  // Side pockets (middle of long rails)
  { x: TABLE_WIDTH / 2, y: RAIL_WIDTH / 2 },
  { x: TABLE_WIDTH / 2, y: TABLE_HEIGHT - RAIL_WIDTH / 2 },
]

function drawTable(ctx: CanvasRenderingContext2D): void {
  // Outer rail (wood colour)
  ctx.fillStyle = '#4a2e0e'
  ctx.fillRect(0, 0, TABLE_WIDTH, TABLE_HEIGHT)

  // Rail border inset line
  ctx.strokeStyle = '#7a5a2e'
  ctx.lineWidth = 3
  ctx.strokeRect(RAIL_WIDTH - 2, RAIL_WIDTH - 2,
    TABLE_WIDTH - 2 * RAIL_WIDTH + 4, TABLE_HEIGHT - 2 * RAIL_WIDTH + 4)

  // Playing surface (green felt)
  ctx.fillStyle = '#1b6e2a'
  ctx.fillRect(RAIL_WIDTH, RAIL_WIDTH,
    TABLE_WIDTH - 2 * RAIL_WIDTH, TABLE_HEIGHT - 2 * RAIL_WIDTH)

  // Subtle felt texture (diagonal lines)
  ctx.strokeStyle = 'rgba(255,255,255,0.03)'
  ctx.lineWidth = 1
  for (let i = RAIL_WIDTH; i < TABLE_WIDTH; i += 30) {
    ctx.beginPath()
    ctx.moveTo(i, RAIL_WIDTH)
    ctx.lineTo(i, TABLE_HEIGHT - RAIL_WIDTH)
    ctx.stroke()
  }

  // Centre line (baulk line)
  ctx.strokeStyle = 'rgba(255,255,255,0.08)'
  ctx.lineWidth = 1
  ctx.beginPath()
  ctx.moveTo(TABLE_WIDTH / 4, RAIL_WIDTH)
  ctx.lineTo(TABLE_WIDTH / 4, TABLE_HEIGHT - RAIL_WIDTH)
  ctx.stroke()

  // Foot spot dot
  ctx.beginPath()
  ctx.arc(TABLE_WIDTH * 0.75, TABLE_HEIGHT / 2, 4, 0, Math.PI * 2)
  ctx.fillStyle = 'rgba(255,255,255,0.3)'
  ctx.fill()

  // Head spot dot
  ctx.beginPath()
  ctx.arc(TABLE_WIDTH * 0.25, TABLE_HEIGHT / 2, 4, 0, Math.PI * 2)
  ctx.fillStyle = 'rgba(255,255,255,0.3)'
  ctx.fill()

  // Pocket holes
  for (const pos of POCKET_POSITIONS) {
    // Shadow ring
    ctx.beginPath()
    ctx.arc(pos.x, pos.y, POCKET_RADIUS + 4, 0, Math.PI * 2)
    ctx.fillStyle = 'rgba(0,0,0,0.5)'
    ctx.fill()

    // Pocket hole
    ctx.beginPath()
    ctx.arc(pos.x, pos.y, POCKET_RADIUS, 0, Math.PI * 2)
    ctx.fillStyle = '#000000'
    ctx.fill()

    // Pocket rim highlight
    ctx.beginPath()
    ctx.arc(pos.x, pos.y, POCKET_RADIUS, 0, Math.PI * 2)
    ctx.strokeStyle = '#5a3a1a'
    ctx.lineWidth = 2
    ctx.stroke()
  }
}

function drawBall(ctx: CanvasRenderingContext2D, ball: Ball): void {
  if (ball.pocketed) return

  const { x, y, id, type } = ball
  const r = BALL_RADIUS

  ctx.save()

  // Drop shadow
  ctx.shadowColor = 'rgba(0,0,0,0.5)'
  ctx.shadowBlur = 6
  ctx.shadowOffsetX = 2
  ctx.shadowOffsetY = 3

  // Clip to ball circle
  ctx.beginPath()
  ctx.arc(x, y, r, 0, Math.PI * 2)
  ctx.clip()

  ctx.shadowColor = 'transparent'

  if (type === 'cue') {
    // White cue ball with radial gradient
    const grad = ctx.createRadialGradient(x - r * 0.3, y - r * 0.3, 1, x, y, r)
    grad.addColorStop(0, '#ffffff')
    grad.addColorStop(0.6, '#f0f0f0')
    grad.addColorStop(1, '#d0d0d0')
    ctx.fillStyle = grad
    ctx.beginPath()
    ctx.arc(x, y, r, 0, Math.PI * 2)
    ctx.fill()
  } else if (type === 'stripe') {
    // White base
    ctx.fillStyle = '#ffffff'
    ctx.beginPath()
    ctx.arc(x, y, r, 0, Math.PI * 2)
    ctx.fill()
    // Coloured middle band (about 55% of diameter)
    const bandHalf = r * 0.55
    ctx.fillStyle = BALL_COLORS[id] ?? '#888888'
    ctx.fillRect(x - r, y - bandHalf, r * 2, bandHalf * 2)
  } else {
    // Solid or black — fill entire circle
    const color = BALL_COLORS[id] ?? '#888888'
    ctx.fillStyle = color
    ctx.beginPath()
    ctx.arc(x, y, r, 0, Math.PI * 2)
    ctx.fill()
  }

  // Specular highlight (small white glint, top-left)
  ctx.beginPath()
  ctx.arc(x - r * 0.3, y - r * 0.35, r * 0.22, 0, Math.PI * 2)
  ctx.fillStyle = 'rgba(255,255,255,0.45)'
  ctx.fill()

  ctx.restore()

  // Outline
  ctx.beginPath()
  ctx.arc(x, y, r, 0, Math.PI * 2)
  ctx.strokeStyle = 'rgba(0,0,0,0.4)'
  ctx.lineWidth = 1
  ctx.stroke()

  // Ball number
  if (id !== 0) {
    const fontSize = id >= 10 ? 8 : 9
    ctx.font = `bold ${fontSize}px sans-serif`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'

    if (type === 'stripe') {
      // Draw number on white area for readability — use colour text
      ctx.fillStyle = BALL_COLORS[id] ?? '#333333'
      // White circle behind number
      ctx.beginPath()
      ctx.arc(x, y, r * 0.42, 0, Math.PI * 2)
      ctx.fillStyle = '#ffffff'
      ctx.fill()
      ctx.fillStyle = '#222222'
    } else if (type === 'black') {
      ctx.fillStyle = '#ffffff'
    } else {
      ctx.fillStyle = '#ffffff'
    }
    ctx.fillText(String(id), x, y)
  }
}

function drawAimingOverlay(
  ctx: CanvasRenderingContext2D,
  cueBall: Ball,
  cursorX: number,
  cursorY: number,
  isDragging: boolean,
): void {
  const dx = cursorX - cueBall.x
  const dy = cursorY - cueBall.y
  const dist = Math.hypot(dx, dy)
  if (dist < 1) return

  const dirX = dx / dist
  const dirY = dy / dist
  const power = Math.min(dist, MAX_DRAG) / MAX_DRAG

  // Aiming line (dashed ray from cue ball in shooting direction)
  ctx.save()
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.65)'
  ctx.lineWidth = 1.5
  ctx.setLineDash([12, 8])
  ctx.beginPath()
  ctx.moveTo(cueBall.x, cueBall.y)
  ctx.lineTo(cueBall.x + dirX * 400, cueBall.y + dirY * 400)
  ctx.stroke()
  ctx.setLineDash([])

  // Ghost ball at end of aiming line
  const ghostX = cueBall.x + dirX * 400
  const ghostY = cueBall.y + dirY * 400
  ctx.beginPath()
  ctx.arc(ghostX, ghostY, BALL_RADIUS, 0, Math.PI * 2)
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.3)'
  ctx.lineWidth = 1
  ctx.stroke()

  ctx.restore()

  // Power bar (only shown while dragging)
  if (isDragging) {
    const BAR_W = 300
    const BAR_H = 14
    const BAR_X = TABLE_WIDTH / 2 - BAR_W / 2
    const BAR_Y = TABLE_HEIGHT - RAIL_WIDTH / 2 - BAR_H / 2

    // Background
    ctx.fillStyle = 'rgba(0, 0, 0, 0.65)'
    ctx.fillRect(BAR_X - 4, BAR_Y - 20, BAR_W + 8, BAR_H + 24)

    // Label
    ctx.fillStyle = '#ffffff'
    ctx.font = 'bold 13px system-ui, sans-serif'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'bottom'
    ctx.fillText(`力度 ${Math.round(power * 100)}%`, TABLE_WIDTH / 2, BAR_Y - 2)

    // Fill
    const barColor = power < 0.5 ? '#4caf50' : power < 0.8 ? '#ff9800' : '#f44336'
    ctx.fillStyle = 'rgba(255,255,255,0.15)'
    ctx.fillRect(BAR_X, BAR_Y, BAR_W, BAR_H)
    if (power > 0) {
      ctx.fillStyle = barColor
      ctx.fillRect(BAR_X, BAR_Y, BAR_W * power, BAR_H)
    }

    // Border
    ctx.strokeStyle = 'rgba(255,255,255,0.4)'
    ctx.lineWidth = 1
    ctx.strokeRect(BAR_X, BAR_Y, BAR_W, BAR_H)
  }
}

function drawPlacementHighlight(ctx: CanvasRenderingContext2D, playerIndex: 0 | 1): void {
  // Highlight the allowed half for cue ball placement
  const left = playerIndex === 0 ? RAIL_WIDTH : TABLE_WIDTH / 2
  const right = playerIndex === 0 ? TABLE_WIDTH / 2 : TABLE_WIDTH - RAIL_WIDTH
  const top = RAIL_WIDTH
  const bottom = TABLE_HEIGHT - RAIL_WIDTH

  ctx.save()
  ctx.fillStyle = 'rgba(255, 255, 100, 0.18)'
  ctx.fillRect(left, top, right - left, bottom - top)

  // Dashed border around the allowed zone
  ctx.strokeStyle = 'rgba(255, 255, 100, 0.7)'
  ctx.lineWidth = 2
  ctx.setLineDash([10, 6])
  ctx.strokeRect(left, top, right - left, bottom - top)
  ctx.setLineDash([])

  // Label
  ctx.fillStyle = 'rgba(255, 255, 100, 0.9)'
  ctx.font = 'bold 18px system-ui, sans-serif'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText('点击放置白球', (left + right) / 2, top + 24)
  ctx.restore()
}

interface AimState {
  cursorX: number
  cursorY: number
  isDragging: boolean
}

interface Props {
  gameState: GameState
  playerIndex: 0 | 1
  isMyTurn: boolean
  ballsMoving: boolean
  canPlaceCueBall: boolean
  onShoot: (dirX: number, dirY: number, power: number) => void
  onPlaceCueBall: (x: number, y: number) => void
}

export default function BilliardTable({ gameState, playerIndex, isMyTurn, ballsMoving, canPlaceCueBall, onShoot, onPlaceCueBall }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [aimState, setAimState] = useState<AimState | null>(null)

  // Refs for stable event handler access
  const canAimRef = useRef(false)
  const canPlaceCueBallRef = useRef(canPlaceCueBall)
  const playerIndexRef = useRef(playerIndex)
  const gameStateRef = useRef(gameState)
  const onShootRef = useRef(onShoot)
  const onPlaceCueBallRef = useRef(onPlaceCueBall)

  const canAim = isMyTurn && !ballsMoving && !canPlaceCueBall

  useEffect(() => { canAimRef.current = canAim }, [canAim])
  useEffect(() => { canPlaceCueBallRef.current = canPlaceCueBall }, [canPlaceCueBall])
  useEffect(() => { playerIndexRef.current = playerIndex }, [playerIndex])
  useEffect(() => { gameStateRef.current = gameState }, [gameState])
  useEffect(() => { onShootRef.current = onShoot }, [onShoot])
  useEffect(() => { onPlaceCueBallRef.current = onPlaceCueBall }, [onPlaceCueBall])

  // Clear aim when it's no longer our turn, balls start moving, or we need to place cue ball
  useEffect(() => {
    if (!canAim) {
      setAimState(null)
    }
  }, [canAim])

  // Draw everything
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    ctx.clearRect(0, 0, TABLE_WIDTH, TABLE_HEIGHT)
    drawTable(ctx)
    for (const ball of gameState.balls) {
      drawBall(ctx, ball)
    }

    // Placement highlight
    if (canPlaceCueBall) {
      drawPlacementHighlight(ctx, playerIndex)
    }

    // Aiming overlay
    if (canAim && aimState) {
      const cueBall = gameState.balls.find(b => b.type === 'cue' && !b.pocketed)
      if (cueBall) {
        drawAimingOverlay(ctx, cueBall, aimState.cursorX, aimState.cursorY, aimState.isDragging)
      }
    }
  }, [gameState, aimState, canAim, canPlaceCueBall, playerIndex])

  const toCanvasCoords = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current
    if (!canvas) return null
    const rect = canvas.getBoundingClientRect()
    return {
      x: (e.clientX - rect.left) * (TABLE_WIDTH / rect.width),
      y: (e.clientY - rect.top) * (TABLE_HEIGHT / rect.height),
    }
  }

  const handleMouseMove = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!canAimRef.current) return
    const pos = toCanvasCoords(e)
    if (!pos) return
    setAimState(prev => ({
      cursorX: pos.x,
      cursorY: pos.y,
      isDragging: prev?.isDragging ?? false,
    }))
  }, [])

  const handleMouseDown = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!canAimRef.current) return
    const pos = toCanvasCoords(e)
    if (!pos) return
    setAimState({
      cursorX: pos.x,
      cursorY: pos.y,
      isDragging: true,
    })
  }, [])

  const handleMouseUp = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    // Handle cue ball placement click
    if (canPlaceCueBallRef.current) {
      const pos = toCanvasCoords(e)
      if (pos) {
        onPlaceCueBallRef.current(pos.x, pos.y)
      }
      return
    }

    if (!canAimRef.current) return
    const pos = toCanvasCoords(e)
    if (!pos) return

    setAimState(prev => {
      if (!prev?.isDragging) return prev

      const cueBall = gameStateRef.current.balls.find(b => b.type === 'cue' && !b.pocketed)
      if (!cueBall) return { ...prev, isDragging: false }

      const dx = pos.x - cueBall.x
      const dy = pos.y - cueBall.y
      const dist = Math.hypot(dx, dy)

      if (dist >= 5) {
        const dirX = dx / dist
        const dirY = dy / dist
        const power = Math.min(dist, MAX_DRAG) / MAX_DRAG
        onShootRef.current(dirX, dirY, power)
      }

      return { ...prev, isDragging: false }
    })
  }, [])

  const handleMouseLeave = useCallback(() => {
    setAimState(prev => {
      // Keep aim state if dragging (user may re-enter canvas)
      if (prev?.isDragging) return prev
      return null
    })
  }, [])

  return (
    <canvas
      ref={canvasRef}
      width={TABLE_WIDTH}
      height={TABLE_HEIGHT}
      style={{
        display: 'block',
        width: '100%',
        maxWidth: TABLE_WIDTH,
        height: 'auto',
        borderRadius: 4,
        boxShadow: '0 8px 32px rgba(0,0,0,0.6)',
        cursor: canPlaceCueBall ? 'cell' : canAim ? 'crosshair' : 'default',
      }}
      onMouseMove={handleMouseMove}
      onMouseDown={handleMouseDown}
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseLeave}
    />
  )
}
