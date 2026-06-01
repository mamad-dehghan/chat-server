import bodyParser from "body-parser";
import cors from "cors";
import express from "express";
import { createServer } from "node:http";
import { Server, Socket } from "socket.io";
import {
  httpAuthMiddleware,
  login,
  singin,
  socketAuthMiddleware,
} from "./modules/authenticate";
import {
  createGroup,
  getAccessChats,
  getDirectChat,
  readChatMessages,
  sendMessage,
} from "./modules/chat";
import { addSession, removeSession } from "./modules/session";
import { readContacts, USER_QUERIES } from "./modules/user";

const app = express();
app.use(
  cors({
    origin: "http://localhost", // Allow your Vite client URL
    methods: ["GET", "POST"],
    credentials: true,
  }),
);
app.use(bodyParser.json());
const httpServer = createServer(app);

const io = new Server(httpServer, {
  cors: {
    origin: "http://localhost", // Allow your Vite client URL
    methods: ["GET", "POST"],
    credentials: true,
  },
});

app.post("/login", login);
app.post("/signin", singin);
app.use(httpAuthMiddleware);
io.use(socketAuthMiddleware);
app.get("/chat/messages/:id", readChatMessages);
app.get("/contacts", readContacts);

// app.all(/.*/, ((req, res) => {
//   console.log("404 Not Found:", req.originalUrl);
//   res.status(404).end();
// }) as RequestHandler);

// const ACTIONS = {
//   CHAT: {
//     getDirectChat: getDirectChat.bind(io),
//   },
//   MESSAGE: {
//     sendMessage: sendMessage.bind(io),
//   },
// };

io.on("connection", (socket: Socket) => {
  addSession(socket);
  socket.join(`user:${socket.user.id}`);
  socket.emit("user_info", socket.user);
  const chats = getAccessChats(socket.user.id);
  // const rooms = chats.map((chat) => String(chat.id));
  socket.join(chats.map((chat) => `chat:${chat.id}`));
  socket.emit("receive_chat", chats);
  console.table({
    // action: "connect",
    username: socket.user.username,
    // socket_id: socket.id,
    rooms: chats.map((c) => c.name).join("|"),
  });

  // Listen for chat messages
  // socket.on("send_message", (data) => {
  //   console.log("Message received:", data);
  //   // Broadcast the message to all connected clients
  //   io.emit("receive_message", data);
  //   // io.in()
  // });

  socket.on("send_message", ({ id, room, content }) => {
    if (id) {
      const message = sendMessage.call(io, { id }, socket.user.id, content);
      return socket.emit("send_message_successful", message);
    }
    const [type, ...others] = room.split(":");
    switch (type) {
      case "direct": {
        const [targetUserId] = others;
        const targetUser = USER_QUERIES.findById(targetUserId);
        if (!targetUser)
          return console.log("Not Exist user: ", type, targetUserId);
        const chat = getDirectChat.call(io, [socket.user.id, targetUser.id]);
        // if (!socket.rooms.has(String(chat.id))) {
        //   for (const session of getUserSessions(socket.user.id)) {
        //     session.join(String(chat.id));
        //   }
        // }
        const message = sendMessage.call(io, chat, socket.user.id, content);
        socket.emit("send_message_successful", { message });
      }
    }
  });

  socket.on("create-room", ({ type, name, user_ids }, callback) => {
    switch (type) {
      case "group": {
        callback(createGroup.call(io, name, user_ids.concat(socket.user.id)));
      }
    }
  });

  // socket.on("join_room", ({ room, type }) => {
  //   switch (type) {
  //     case "user": {
  //       const targetUser = USER_QUERIES.find(room);
  //       if (!targetUser) return console.log("Not Exist user: ", type);
  //     }
  //     // check user exist
  //     // join this and target user to room
  //     case "group":
  //     case "channel":
  //       console.log("Not implemented: ", type);
  //   }
  // });

  socket.on("disconnect", () => {
    // console.log("User disconnected:", socket.id);
    removeSession(socket);
  });
});

DB: {
  USER_QUERIES.createTable();
}

const PORT = process.env.PORT || 3000;
httpServer.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
