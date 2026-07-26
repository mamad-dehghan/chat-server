import { Socket } from "socket.io";
import { chatModel, chatModelDetails, userChatModelDetails } from "./chat";
import { DB, QUERY_MAP, tableModel } from "./storage";
import { userModelDetails } from "./user";
import { RequestHandler } from "express";
import { app } from "../server";

// declare module "socket.io/dist/typed-events" {
//   interface DefaultEventsMap {
//     // Define your events here
//     join_room: (room: string) => void;
//     send_message: (data: { user: string; text: string }) => void;
//     // ...
//   }
// }

export interface messageModel {
  id: number;
  chat_id: number;
  user_id: number;
  message: string;
  created_at: string;
}

export const messageModelDetails: tableModel<messageModel> = {
  name: "message_table",
  fields: ["id", "chat_id", "user_id", "message", "created_at"],
  defaults: {},
};

DB: {
  DB.run(`
    CREATE TABLE IF NOT EXISTS ${messageModelDetails.name} (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      chat_id INTEGER NOT NULL,
      message TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (chat_id) REFERENCES ${chatModelDetails.name}(id) ON DELETE CASCADE,
      FOREIGN KEY (user_id) REFERENCES ${userModelDetails.name}(id) ON DELETE CASCADE
    )
  `);
}

export const MessageController = {
  sendMessage(this: Socket, chat: Pick<chatModel, "id">, content: string) {
    const message = QUERY_MAP.create<messageModel>(messageModelDetails)({
      chat_id: chat.id,
      user_id: this.user.id,
      message: content,
      created_at: new Date().toJSON(),
    });

    this.to(`chat:${chat.id}`).emit("new_message", message);
    return message;
  },
};

export const MessageHandler = {
  readChatMessages() {
    app.get("/chat/messages/:id", (req, res, next) => {
      const chat_id = req.params.id as string;
      const [hasAccess] = DB.query(
        `
          SELECT COUNT(*)
          FROM ${userChatModelDetails.name}
          WHERE ${userChatModelDetails.name}.user_id = $user_id
          AND ${userChatModelDetails.name}.chat_id = $chat_id
        `,
      )
        .values({
          $user_id: req.user.id,
          $chat_id: chat_id,
        })
        .flat();

      if (!hasAccess) return res.status(404).json({ error: "Access Denied." });

      const messages = DB.query(
        `SELECT * FROM ${messageModelDetails.name} WHERE chat_id = $chat_id`,
      ).all({
        $chat_id: chat_id,
      });
      res.json(messages);
    });
  },
};
