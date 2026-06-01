import { NextFunction, Request, Response } from "express";
import { Socket, ExtendedError } from "socket.io";

export type SocketMiddleware = (
  socket: Socket,
  next: (err?: ExtendedError) => void,
) => void;

export type HttpMiddleware = (
  req: Request,
  res: Response,
  next: NextFunction,
) => void | Promise<void>;
