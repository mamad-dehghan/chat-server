import { DB, QUERY_MAP, tableModel } from "./storage";
import { userModel, userModelDetails } from "./user";
import { RequestHandler } from "express";
import { Server } from "socket.io";

// const openChatDB = (id: string): Database => {
//   const db = new Database(DATABASE_BASE_PATH + `${id}.db`);
//   db.run("PRAGMA journal_mode = WAL;");

//   const TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes in milliseconds
//   let closeTimer: ReturnType<typeof setTimeout> | null = null;

//   const closeDatabase = () => {
//     console.log("Database inactive for 10 minutes. Closing connection...");
//     db.close();
//     CHATS_DBS.delete(id);
//   };

//   const resetTimer = () => {
//     if (closeTimer) clearTimeout(closeTimer);

//     closeTimer = setTimeout(() => {
//       closeDatabase();
//     }, TIMEOUT_MS);
//   };

//   resetTimer();

//   const dbHandler = {
//     get(target: any, prop: any) {
//       const value = target[prop];

//       // If the property is a function (like .query, .run, .exec)
//       if (typeof value === "function") {
//         return function (...args: any[]) {
//           resetTimer();

//           return value.apply(target, args);
//         };
//       }

//       return value;
//     },
//   };

//   return new Proxy(db, dbHandler);
// };

function getChats(mainDB: string, relationDB: string) {
  return DB.query(`
    SELECT ${mainDB}.*
    FROM ${mainDB}
    JOIN ${relationDB} ON ${mainDB}.id = ${relationDB}.chat_id
    WHERE ${relationDB}.user_id = $user_id
  `);
}

export interface chatModel {
  readonly id: number;
  name: string;
  displayName?: string;
  type: string;
  created_at: string;
}
export const chatModelDetails: tableModel<chatModel> = {
  name: "chat_table",
  fields: ["id", "name", "type", "created_at"],
  defaults: {},
};
DB: {
  DB.run(`
  CREATE TABLE IF NOT EXISTS ${chatModelDetails.name} (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT UNIQUE NOT NULL,
    type TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )
`);
}
export interface userChatModel {
  readonly id: number;
  user_id: number;
  chat_id: number;
  role: string;
  joined_at: string;
}
export const userChatModelDetails: tableModel<userChatModel> = {
  name: "user_chat_table",
  fields: ["id", "user_id", "chat_id", "role", "joined_at"],
  defaults: {},
};
DB: {
  DB.run(`
    CREATE TABLE IF NOT EXISTS ${userChatModelDetails.name} (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      chat_id INTEGER NOT NULL,
      user_id INTEGER NOT NULL,
      role TEXT DEFAULT 'member',
      joined_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (chat_id) REFERENCES ${chatModelDetails.name}(id) ON DELETE CASCADE,
      FOREIGN KEY (user_id) REFERENCES ${userModelDetails.name}(id) ON DELETE CASCADE,
      UNIQUE(chat_id, user_id)
    )
  `);
}

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

const extractUserIDsFromDirectChat = (chat_name: string) =>
  chat_name
    .slice("direct-".length)
    .split(",")
    .map((id) => parseInt(id));

export function getAccessChats(userID: number): chatModel[] {
  const chats = getChats(chatModelDetails.name, userChatModelDetails.name).all({
    $user_id: userID,
  }) as chatModel[];

  const directChatUserIDs = chats
    .filter((chat) => chat.type === "direct")
    .map((chat) => extractUserIDsFromDirectChat(chat.name))
    .flat()
    .filter((user_id) => user_id !== userID);
  if (directChatUserIDs.length) {
    const directChatUsers = DB.query(
      `SELECT id, username FROM ${userModelDetails.name} WHERE id IN (${directChatUserIDs.join(",")})`,
    ).all() as userModel[];
    for (const chat of chats) {
      if (chat.type === "group") {
        chat.displayName = chat.name;
      }
      if (chat.type === "direct") {
        const [anotherID] = chat.name
          .slice("direct-".length)
          .split(",")
          .filter((user_id) => +user_id !== userID);
        if (!anotherID) continue;
        const targetUser = directChatUsers.find(
          (user) => user.id === +anotherID,
        );
        if (!targetUser) continue;
        chat.displayName = targetUser.username;
      }
    }
  }
  return chats;
}

export function getDirectChat(this: Server, userIDs: [number, number]) {
  const chat = DB.query(
    `SELECT * FROM ${chatModelDetails.name} WHERE name = $name AND type = $type`,
  ).get({
    $name: ["direct", userIDs.sort()].join("-"),
    $type: "direct",
  }) as chatModel | null;
  if (chat) return chat;
  const created = QUERY_MAP.create<chatModel>(chatModelDetails)({
    name: ["direct", userIDs.sort()].join("-"),
    type: "direct",
    created_at: new Date().toJSON(),
  });
  for (const user_id of userIDs) {
    QUERY_MAP.create<userChatModel>(userChatModelDetails)({
      chat_id: created.id,
      role: "member",
      user_id: user_id,
      joined_at: new Date().toJSON(),
    });
  }

  for (const userID of userIDs) {
    this.in(`user:${userID}`).socketsJoin(`chat:${created.id}`);
  }
  // TODO: separate and add display name
  this.in(`chat:${created.id}`).emit("join_room", created);

  return created;
}

export function sendMessage(
  this: Server,
  chat: Pick<chatModel, "id">,
  user_id: number,
  content: string,
) {
  const message = QUERY_MAP.create<messageModel>(messageModelDetails)({
    chat_id: chat.id,
    user_id: user_id,
    message: content,
    created_at: new Date().toJSON(),
  });

  this.in(`chat:${chat.id}`).emit("new_message", message);
  return message;
}

export const readChatMessages: RequestHandler = (req, res, next) => {
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
};

export function createGroup(
  this: Server,
  groupName: string,
  user_ids: number[],
) {
  const created = QUERY_MAP.create<chatModel>(chatModelDetails)({
    name: groupName,
    // displayName: groupName,
    type: "group",
    created_at: new Date().toJSON(),
  });
  console.log(created);
  for (const user_id of user_ids) {
    QUERY_MAP.create<userChatModel>(userChatModelDetails)({
      chat_id: created.id,
      role: "admin",
      user_id: user_id,
      joined_at: new Date().toJSON(),
    });
    this.in(`user:${user_id}`).socketsJoin(`chat:${created.id}`);
  }
  this.in(`chat:${created.id}`).emit("join_room", created);
  return created;
}
