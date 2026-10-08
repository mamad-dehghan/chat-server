import { Socket } from "socket.io";
import { app } from "../server.js";
import {
  ChatController,
  type chatModel,
  chatModelDetails,
  userChatModelDetails,
} from "./chat.js";
import { DiskController, type diskModel } from "./disk.js";
import { DB, QUERY_MAP, type tableModel } from "./storage.js";
import { userModelDetails } from "./user.js";

// declare module "socket.io/dist/typed-events" {
//   interface DefaultEventsMap {
//     // Define your events here
//     join_room: (room: string) => void;
//     send_message: (data: { user: string; text: string }) => void;
//     // ...
//   }
// }

export interface Referrence {
  chat_id: number;
  message_id: number;
}
export interface directMessageAttachment {
  type: "image" | "video" | "gif" | "file";
  name: string;
  file: Buffer;
}
export interface referrenceMessageAttachment {
  type: "image" | "video" | "gif" | "file";
  id: number;
  access: Referrence;
}
export type messageAttachment =
  directMessageAttachment | referrenceMessageAttachment;
export interface messageModel_v2 {
  id: number;
  chat_id: number;
  user_id: number;
  caption: string;
  created_at: string;
  attachment: Omit<diskModel, "created_at" | "path">[] | null;
  referrer: Referrence | null;
  replay_to: number | null;
  is_edited: boolean;
  seen: boolean;
}

export interface messageDBModel {
  id: number;
  chat_id: number;
  user_id: number;
  caption: string;
  created_at: string;
  attachment: string;
  referrer: string;
  replay_to: number | null;
  is_edited: number;
  seen: number;
}

export const messageModelDetails_v2: tableModel<messageDBModel> = {
  name: "message_table_v2",
  fields: [
    "id",
    "chat_id",
    "user_id",
    "caption",
    "created_at",
    "attachment",
    "referrer",
    "replay_to",
    "is_edited",
    "seen",
  ],
  defaults: {},
};

DB: {
  DB.run(`
    CREATE TABLE IF NOT EXISTS ${messageModelDetails_v2.name} (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      chat_id INTEGER NOT NULL,
      caption TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      attachment TEXT DEFAULT "null",
      referrer INTEGER DEFAULT "null",
      replay_to TEXT DEFAULT "null",
      is_edited TINYINT(1) DEFAULT 0,
      seen TINYINT(1) DEFAULT 0,
      FOREIGN KEY (chat_id) REFERENCES ${chatModelDetails.name}(id) ON DELETE CASCADE,
      FOREIGN KEY (user_id) REFERENCES ${userModelDetails.name}(id) ON DELETE CASCADE
    )
  `);
}

export const MessageUtils = {
  toModel({
    referrer,
    attachment,
    is_edited,
    seen,
    ...item
  }: Omit<messageDBModel, "id">): Omit<messageModel_v2, "id"> {
    return {
      ...item,
      referrer: JSON.parse(referrer),
      attachment: JSON.parse(attachment),
      is_edited: is_edited == 1,
      seen: seen == 1,
    };
  },
  toDB({
    referrer,
    attachment,
    is_edited,
    seen,
    ...item
  }: Omit<messageModel_v2, "id">): Omit<messageDBModel, "id"> {
    return {
      ...item,
      referrer: JSON.stringify(referrer),
      attachment: JSON.stringify(attachment),
      is_edited: is_edited ? 1 : 0,
      seen: seen ? 1 : 0,
    };
  },
};

export const MessageController = {
  async sendMessage(
    this: Socket,
    chat: Pick<chatModel, "id">,
    {
      caption,
      attachment,
      replay_to,
      referrer,
    }: Omit<messageModel_v2, "chat_id" | "attachment"> & {
      attachment: messageAttachment[] | null;
    },
  ) {
    let computedAttachment: messageModel_v2["attachment"] = null;
    if (attachment !== null) {
      computedAttachment = [];
      for (let i = 0; i < attachment.length; i++) {
        const currentItem = attachment[i]!;

        if ("file" in currentItem) {
          computedAttachment.push(await DiskController.store(currentItem));
          continue;
        } else if ("id" in currentItem) {
          const item = DiskController.find.call(this, currentItem);
          // check id exist
          // check access is corect
          if (item) {
            computedAttachment.push(item);
            continue;
          }
        }
        // ?notice item is illegal
        // drop item in list
      }
    }

    // TODO: store attachment, check attachment access if used reference
    const message = MessageUtils.toModel(
      QUERY_MAP.create<messageDBModel>(messageModelDetails_v2)(
        MessageUtils.toDB({
          chat_id: chat.id,
          user_id: this.user.id,
          caption: caption,
          attachment: computedAttachment,
          referrer,
          replay_to,
          seen: false,
          is_edited: false,
          created_at: new Date().toJSON(),
        }),
      ),
    );
    this.to(`chat:${chat.id}`).emit("new_message", message);
    return message;
  },

  deleteMessage(
    this: Socket,
    message: Pick<messageModel_v2, "id" | "chat_id">,
  ): { id: number; chat_id: number } {
    if (!ChatController.hasChatAccess(this.user.id, message.chat_id))
      throw "Access denied.";

    const res = DB.query(
      `
        DELETE
        FROM ${messageModelDetails_v2.name}
        WHERE id = $id
        AND user_id = $user_id
      `,
    ).run({
      $user_id: this.user.id,
      $id: message.id,
    });

    if (!res.changes) throw "Not found or not owner.";

    const payload = { id: message.id, chat_id: message.chat_id };
    this.to(`chat:${message.chat_id}`).emit("delete_message", payload);
    return payload;
  },

  deleteAttachments(
    this: Socket,
    {
      chat_id,
      message_id,
      attachment_ids = [],
    }: {
      chat_id: number;
      message_id: number;
      attachment_ids?: (number | string)[];
    },
  ): { message: messageModel_v2 } {
    if (!ChatController.hasChatAccess(this.user.id, chat_id))
      throw "Access denied.";

    const row = DB.query(
      `
      SELECT *
      FROM ${messageModelDetails_v2.name}
      WHERE id = $message_id
      AND user_id = $user_id
      AND chat_id = $chat_id
      `,
    ).get({
      $user_id: this.user.id,
      $message_id: message_id,
      $chat_id: chat_id,
    }) as messageDBModel | null;
    if (!row) throw "Not found or not owner.";

    const normalizedIds = attachment_ids.map((id) => Number(id));
    let computedAttachment: messageModel_v2["attachment"] = JSON.parse(
      row.attachment,
    );
    computedAttachment =
      computedAttachment?.filter(
        (at) => !normalizedIds.includes(Number(at.id)),
      ) ?? null;
    if (!computedAttachment?.length) computedAttachment = null;

    const previous = MessageUtils.toModel(row);
    const updatedMessage: messageModel_v2 = {
      ...previous,
      id: row.id,
      chat_id: row.chat_id,
      user_id: row.user_id,
      created_at: row.created_at,
      attachment: computedAttachment,
      is_edited: true,
    };
    DB.query(
      `
        UPDATE ${messageModelDetails_v2.name}
        SET attachment = $attachment, is_edited = 1
        WHERE id = $id
        AND user_id = $user_id
      `,
    ).run({
      $attachment: JSON.stringify(computedAttachment),
      $id: message_id,
      $user_id: this.user.id,
    });

    this.to(`chat:${chat_id}`).emit("update_message", updatedMessage);
    return { message: updatedMessage };
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
        `SELECT * FROM ${messageModelDetails_v2.name} WHERE chat_id = $chat_id`,
      ).all({
        $chat_id: chat_id,
      });
      res.json(messages.map(MessageUtils.toModel));
    });
  },
};
