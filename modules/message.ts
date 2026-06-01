declare module "socket.io/dist/typed-events" {
  interface DefaultEventsMap {
    // Define your events here
    join_room: (room: string) => void;
    send_message: (data: { user: string; text: string }) => void;
    // ...
  }
}
