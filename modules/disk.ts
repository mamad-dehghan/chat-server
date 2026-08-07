import { Socket } from "socket.io";
import { app } from "../server";
import { userChatModelDetails } from "./chat";
import {
  directMessageAttachment,
  messageDBModel,
  messageModel_v2,
  messageModelDetails_v2,
  MessageUtils,
  referrenceMessageAttachment,
} from "./message";
import { DB, QUERY_MAP, tableModel } from "./storage";

export interface diskModel {
  readonly id: number;
  path: string;
  name: string;
  type: string;
  created_at: string;
}
export const diskModelDetails: tableModel<diskModel> = {
  name: "disk_table",
  fields: ["id", "path", "name", "type", "created_at"],
  defaults: {},
};

// export interface messageDiskModel {
//   readonly id: number;
//   disk_id: number;
//   chat_id: number;
//   message_id: number;
// }
// export const messageDiskModelDetails: tableModel<messageDiskModel> = {
//   name: "user_chat_table",
//   fields: ["id", "disk_id", "chat_id", "message_id"],
//   defaults: {},
// };

DB: {
  DB.run(`
  CREATE TABLE IF NOT EXISTS ${diskModelDetails.name} (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    path VARCHAR(40) NOT NULL,
    name TEXT NOT NULL,
    type VARCHAR(10) NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )
`);

  // DB.run(`
  //   CREATE TABLE IF NOT EXISTS ${messageDiskModelDetails.name} (
  //     id INTEGER PRIMARY KEY AUTOINCREMENT,
  //     chat_id INTEGER NOT NULL,
  //     user_id INTEGER NOT NULL,
  //     message_id INTEGER NOT NULL,
  //     role TEXT DEFAULT 'member',
  //     joined_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  //     FOREIGN KEY (chat_id) REFERENCES ${chatModelDetails.name}(id) ON DELETE CASCADE,
  //     FOREIGN KEY (user_id) REFERENCES ${userModelDetails.name}(id) ON DELETE CASCADE,
  //     FOREIGN KEY (message_id) REFERENCES ${userModelDetails.name}(id) ON DELETE CASCADE,
  //     UNIQUE(chat_id, user_id, message_id)
  //   )
  // `);
}

export const DiskController = {
  async store({ file, name, type }: directMessageAttachment) {
    const fileName = [
      Date.now(),
      "-",
      Bun.hash(file),
      name.slice(name.lastIndexOf(".")),
    ].join("");

    const { path, created_at, ...item } = QUERY_MAP.create<diskModel>(
      diskModelDetails,
    )({
      path: fileName,
      name,
      type,
      created_at: new Date().toJSON(),
    });

    await Bun.write(`disk/${fileName}`, file);
    return item;
  },
  find(this: Socket, { id, type, access }: referrenceMessageAttachment) {
    const [hasChatAccess] = DB.query(
      `
        SELECT COUNT(*)
        FROM ${userChatModelDetails.name}
        WHERE ${userChatModelDetails.name}.user_id = $user_id
        AND ${userChatModelDetails.name}.chat_id = $chat_id
      `,
    )
      .values({
        $user_id: this.user.id,
        $chat_id: access.chat_id,
      })
      .flat();

    if (!hasChatAccess) return;

    const message = DB.query(
      `SELECT attachment FROM ${messageModelDetails_v2.name} WHERE id = $message_id AND chat_id = $chat_id`,
    ).get({
      $message_id: access.message_id,
      $chat_id: access.chat_id,
    }) as messageDBModel | null;
    if (message) {
      const m = MessageUtils.toModel(message);
      const disk = m.attachment?.find((at) => at.id === id && at.type === type);
      return disk;
    }
  },
};

export const DiskHandler = {
  read() {
    app.get("/attachment", function (req, res, next) {
      const id = Number(req.query.id);
      const message_id = Number(req.query.message_id);
      const chat_id = Number(req.query.chat_id);
      const [hasChatAccess] = DB.query(
        `
          SELECT COUNT(*)
          FROM ${userChatModelDetails.name}
          WHERE ${userChatModelDetails.name}.user_id = $user_id
          AND ${userChatModelDetails.name}.chat_id = $chat_id
        `,
      )
        .values({
          $user_id: req.user.id,
          $chat_id: String(chat_id),
        })
        .flat();

      if (!hasChatAccess) {
        res.end();
      }
      const message = DB.query(
        `SELECT attachment FROM ${messageModelDetails_v2.name} WHERE id = $message_id AND chat_id = $chat_id`,
      ).get({
        $message_id: String(message_id),
        $chat_id: String(chat_id),
      }) as messageDBModel | null;

      if (message) {
        const at: messageModel_v2["attachment"] = JSON.parse(
          message.attachment,
        );
        const exist = at?.some((at) => at.id === id);
        if (exist) {
          const disk = DB.query(
            `SELECT path FROM ${diskModelDetails.name} WHERE id = $id`,
          ).get({
            $id: String(id),
          }) as diskModel | null;
          if (disk?.path) return res.download(`disk/${disk?.path}`);
        }
      }
      res.end();
    });
  },
};
