import { Socket } from "socket.io";

const Sessions = new Map<number, Set<string>>();

export function addSession(socket: Socket) {
  const userSessions = Sessions.get(socket.user.id) ?? new Set<string>();
  if (userSessions.has(socket.id)) return;
  userSessions.add(socket.id);
  Sessions.set(socket.user.id, userSessions);
}
export function removeSession(socket: Socket) {
  const userSessions = Sessions.get(socket.user.id) ?? new Set<string>();
  if (!userSessions.has(socket.id)) return;
  userSessions.delete(socket.id);
  if (userSessions.size) Sessions.set(socket.user.id, userSessions);
  else Sessions.delete(socket.user.id);
}
export function getUserSessionIDs(userID: number) {
  const userSessions = Sessions.get(userID) ?? new Set<string>();
  return userSessions.keys();
}
