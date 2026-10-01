import cors from "cors";
import express from "express";
import { createServer } from "node:http";
import { Server, Socket } from "socket.io";
import {
  AuthHandler,
  httpAuthMiddleware,
  socketAuthMiddleware,
} from "./modules/authenticate.js";
import { ChatController } from "./modules/chat.js";
import { MessageController, MessageHandler } from "./modules/message.js";
import { USER_QUERIES, UserHandler } from "./modules/user.js";
import { DiskHandler } from "./modules/disk.js";

DB: {
  USER_QUERIES.createTable();
}

export const app = express();
app.use(
  cors({
    origin: (origin, callback) => {
      callback(null, origin);
    },
    methods: ["GET", "POST"],
    // methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    // allowedHeaders: ["Content-Type", "Authorization"],
    credentials: true,
  }),
);
app.use(express.json());
const httpServer = createServer(
  // {
  //   key: await Bun.file("./cert.key").text(),
  //   cert: await Bun.file("./cert.crt").text(),
  // },
  app,
);

const io = new Server(httpServer, {
  cors: {
    origin: (origin, callback) => {
      callback(null, origin);
    },
    methods: ["GET", "POST"],
    credentials: true,
  },
});

AuthHandler.login();
AuthHandler.signin();
app.use(httpAuthMiddleware);
io.use(socketAuthMiddleware);
MessageHandler.readChatMessages();
UserHandler.readContacts();
DiskHandler.read();

io.on("connection", (socket: Socket) => {
  socket.join(`user:${socket.user.id}`);
  socket.emit("user_info", socket.user);
  const chats = ChatController.getAccessChats(socket.user.id);
  socket.join(chats.map((chat) => `chat:${chat.id}`));
  socket.emit("receive_chat", chats);

  socket.on("send_message", async ({ id, room, ...content }, callback) => {
    if (id) {
      return callback(
        await MessageController.sendMessage.call(socket, { id }, content),
      );
    }
    const [type, ...others] = room.split(":");
    switch (type) {
      case "direct": {
        const [targetUserId] = others;
        const targetUser = USER_QUERIES.findById(targetUserId);
        if (!targetUser)
          return console.log("Not Exist user: ", type, targetUserId);
        const chat = ChatController.getDirectChat.call(io, [
          socket.user.id,
          targetUser.id,
        ]);

        callback(
          await MessageController.sendMessage.call(socket, chat, content),
        );
      }
    }
  });

  socket.on("create-room", ({ type, name, user_ids }, callback) => {
    switch (type) {
      case "group": {
        callback(
          ChatController.createGroup.call(
            io,
            name,
            user_ids.concat(socket.user.id),
          ),
        );
      }
    }
  });

  // socket.on("delete-message", async ({ message_ids, chat_id }, callback) => {
  //   callback(
  //     await MessageController.deleteMessage.call(socket, chat_id, message_ids),
  //   );
  // });
});

const PORT = process.env.PORT || 3000;
httpServer.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
