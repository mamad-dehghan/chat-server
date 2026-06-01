import { Database } from "bun:sqlite";

export const DATABASE_BASE_PATH = "database/";

export const DB = new Database(DATABASE_BASE_PATH + "mychat.db");
DB.run("PRAGMA journal_mode = WAL;");

export interface tableModel<T> {
  name: string;
  fields: (keyof T)[];
  defaults: Partial<T>;
}

export const QUERY_MAP = {
  create<T>(model: tableModel<T>) {
    return function (row: Omit<T, "id">): T {
      const completeRow: Omit<T, "id"> = {
        ...model.defaults,
        ...row,
      };
      const values = Object.entries(completeRow)
        .filter((row) => model.fields.includes(row[0] as keyof T))
        .filter((row) => row[1] !== undefined);
      // console.log(row, values);
      if (!values.length) throw new Error("You should pass at least one field");
      const result = DB.query(
        `INSERT INTO ${model.name}
          (${values.map((row) => row[0]).join(", ")})
          VALUES (${values.map((row) => "$" + row[0]).join(", ")})
        `,
      ).run(
        Object.fromEntries(values.map((row) => ["$" + row[0], row[1] ?? null])),
      );
      return { ...completeRow, id: result.lastInsertRowid };
    };
  },
  update<T>(model: tableModel<T>) {
    return function (row: T) {
      const values = Object.entries(row as {})
        .filter((row) => model.fields.includes(row[0] as keyof T))
        .filter((row) => row[1] !== undefined);
      if (!values.length) throw new Error("You should pass at least one field");
      return DB.query(
        `UPDATE ${model.name}
          SET (${values.map((row) => row[0]).join(", ")})
          VALUES (${values.map((row) => "$" + row[0]).join(", ")})
        `,
      ).run(Object.fromEntries(values.map((row) => ["$" + row[0], row[1]])));
    };
  },
};

// try {
//   insertUser.run({ $username: "Ali", $token: "secret-token-123" });
//   console.log("User inserted!");
// } catch (error) {
//   console.log("User might already exist:", error);
// }

// 5. Query users
// const allUsers = DB.query("SELECT * FROM users").all();
// console.log("All users:", allUsers);
