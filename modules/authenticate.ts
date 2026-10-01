import { parse, serialize } from "cookie";
import { type HttpMiddleware, type SocketMiddleware } from "../types.js";
import { DB } from "./storage.js";
import { USER_QUERIES, type userModel, userModelDetails } from "./user.js";
import { app } from "../server.js";

const AUTH_COOKIE_NAME = "auth_token";

const AUTH_QUERIES = {
  login(row: Pick<userModel, "username" | "password">) {
    return DB.query(
      `SELECT * FROM ${userModelDetails.name} WHERE username = $username AND password = $password`,
    ).get({
      $username: row.username,
      $password: row.password,
    });
  },
  exist(username: string) {
    return DB.query(
      `SELECT * FROM ${userModelDetails.name} WHERE username = $username`,
    ).values({
      $username: username,
    })?.[0]?.[0] as boolean;
  },
};

export const httpAuthMiddleware: HttpMiddleware = (req, res, next) => {
  const cookies = req.headers?.cookie;
  if (!cookies) {
    res.status(401).json("Authentication error: No cookies");
    return;
    // return next(new Error("Authentication error: No cookies"));
  }

  const token = parse(cookies)[AUTH_COOKIE_NAME];
  try {
    const user = token ? (JSON.parse(token) as userModel) : undefined;
    if (!user) throw new Error();
    if (!AUTH_QUERIES.exist(user.username)) throw new Error();

    req.user = {
      id: user.id,
      username: user.username,
    };
    next();
  } catch (_) {
    res.status(401).json("Authentication error: Invalid token");
    // next(new Error("Authentication error: Invalid token"));
  }
};

export const socketAuthMiddleware: SocketMiddleware = (socket, next) => {
  const cookies = socket.handshake.headers.cookie;
  if (!cookies) {
    return next(new Error("Authentication error: No cookies"));
  }

  const token = parse(cookies)[AUTH_COOKIE_NAME];
  try {
    const user = token ? (JSON.parse(token) as userModel) : undefined;
    if (!user) throw new Error();
    if (!AUTH_QUERIES.exist(user.username)) throw new Error();

    socket.user = {
      id: user.id,
      username: user.username,
    };
    next();
  } catch (_) {
    next(new Error("Authentication error: Invalid token"));
  }
};

export const AuthHandler = {
  login() {
    app.post("/login", function (req, res, next) {
      console.log("in login");
      if (!req.body.username || !req.body.password)
        return next("Wrong username or password");

      const user = AUTH_QUERIES.login({
        username: req.body.username,
        password: req.body.password,
      }) as userModel | null;

      if (!user) return next("Wrong username or password");

      const token = JSON.stringify({
        id: user.id,
        username: user.username,
      });
      // Set the cookie
      res.setHeader(
        "Set-Cookie",
        serialize(AUTH_COOKIE_NAME, token, {
          httpOnly: true, // JS cannot read this (security)
          secure: false, // Set to true if using HTTPS
          sameSite: true,
          // path: "/",
          maxAge: 60 * 30, // 30 min
        }),
      );

      res.status(200).end();
    });
  },
  signin() {
    app.post("/signin", function (req, res, next) {
      if (!req.body.username || !req.body.password)
        return next("Wrong format of username or password");

      const [[isBusyUsername]] = DB.query<
        [[number]],
        Record<"$username", string>
      >(
        `SELECT COUNT(*) FROM ${userModelDetails.name} WHERE username = $username`,
      ).values({
        $username: req.body.username,
      });
      if (isBusyUsername) return next("This username is taken already");

      const user = USER_QUERIES.create({
        username: req.body.username,
        password: req.body.password,
      });

      const token = JSON.stringify({
        id: user.id,
        username: user.username,
      });
      res.setHeader(
        "Set-Cookie",
        serialize(AUTH_COOKIE_NAME, token, {
          httpOnly: true,
          secure: false,
          sameSite: true,
          maxAge: 60 * 30, // 30 min
        }),
      );

      res.status(201).end();
    });
  },
};
