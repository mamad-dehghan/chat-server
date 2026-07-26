import { RequestHandler } from "express";
import { DB, QUERY_MAP, tableModel } from "./storage";
import { app } from "../server";

export interface userModel {
  readonly id: number;
  username: string;
  password: string;
}

declare module "socket.io" {
  interface Socket {
    user: {
      readonly id: number;
      readonly username: string;
    };
  }
}
declare global {
  namespace Express {
    interface Request {
      user: {
        readonly id: number;
        readonly username: string;
      };
    }
  }
}

export const userModelDetails: tableModel<userModel> = {
  name: "user_table",
  fields: ["id", "username", "password"],
  defaults: {},
};

export const USER_QUERIES = {
  createTable() {
    DB.run(`
      CREATE TABLE IF NOT EXISTS ${userModelDetails.name} (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT UNIQUE NOT NULL,
        password TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);
  },
  create: QUERY_MAP.create(userModelDetails),
  update: QUERY_MAP.update(userModelDetails),
  findByUsername: (username: string) => {
    return DB.query(
      `SELECT * FROM ${userModelDetails.name} WHERE username = $username`,
    ).get({
      $username: username,
    }) as userModel | null;
  },
  findById: (id: number) => {
    return DB.query(
      `SELECT * FROM ${userModelDetails.name} WHERE id = $id`,
    ).get({
      $id: id,
    }) as userModel | null;
  },

  //   DB.query(
  //   "INSERT INTO users (username, password) VALUES ($username, $password)",
  // ),
  // update: DB.query(
  //   "UPDATE users set (username, password) VALUES ($username, $password)",
  // ),
};

export const UserHandler = {
  readContacts() {
    app.get("/contacts", function (req, res, next) {
      const contacts = DB.query(
        `SELECT id, username FROM ${userModelDetails.name} WHERE id != $id`,
      ).all({ $id: req.user.id }) as userModel[];
      // console.log(contacts);
      res.status(200).json(contacts).end();
    });
  },
};
