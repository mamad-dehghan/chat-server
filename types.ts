import { type NextFunction, type Request, type Response } from "express";
import { type ExtendedError, Socket } from "socket.io";

export type SocketMiddleware = (
  socket: Socket,
  next: (err?: ExtendedError) => void,
) => void;

export type HttpMiddleware = (
  req: Request,
  res: Response,
  next: NextFunction,
) => void | Promise<void>;
