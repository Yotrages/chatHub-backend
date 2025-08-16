import { Server } from "socket.io";



const onlineUsers = new Map<string, string>()

export const setUpSocket = (io: Server) => {
    io.on('connection', async (socket) => {
        const token = socket.handshake.auth.token
        console.log('socket and user connected', socket.userId)

        socket.emit('new_connection', {
            userId: socket.userId,
            socketId: socket.id,
            timestamp: new Date().toISOString()
        })

        onlineUsers.set(socket.userId, socket.id)

        socket.on('notification', (data) => createNotification(socket, data) )
    })
}

export const createNotification = (socket: any, data: any) => {
}

const playGround = [
    {item: 'djjd', id: 1},
    {item: 'fhfh', id: 2}
]

const whatEver = playGround.reduce((first, sec) => {

}, {} as any)