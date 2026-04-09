import { WebSocketServer } from 'ws'

const PORT = 8080

const wss = new WebSocketServer({ port: PORT })

wss.on('listening', () => {
  console.log(`WebSocket server listening on port ${PORT}`)
})

wss.on('connection', (ws) => {
  console.log('Client connected')

  ws.on('message', (data) => {
    console.log('Message received:', data.toString())
  })

  ws.on('close', () => {
    console.log('Client disconnected')
  })
})
