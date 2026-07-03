import * as SQLite from 'expo-sqlite';

/** Single shared handle — two connections writing the same file invite SQLITE_BUSY. */
export const db = SQLite.openDatabaseSync('jellyfinner.db');
