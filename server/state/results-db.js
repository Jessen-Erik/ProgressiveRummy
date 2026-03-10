import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";

export class ResultsDb {
  constructor(dbFilePath) {
    const dbDir = path.dirname(dbFilePath);
    fs.mkdirSync(dbDir, { recursive: true });

    this.db = new Database(dbFilePath);
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("synchronous = NORMAL");

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS game_results (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        winner_name TEXT NOT NULL,
        winner_score INTEGER NOT NULL,
        finished_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
      CREATE INDEX IF NOT EXISTS idx_game_results_winner_name ON game_results(winner_name);
      CREATE INDEX IF NOT EXISTS idx_game_results_winner_score ON game_results(winner_score);
    `);

    this.insertResultStmt = this.db.prepare(`
      INSERT INTO game_results (winner_name, winner_score)
      VALUES (?, ?)
    `);

    this.totalWinsStmt = this.db.prepare(`
      SELECT winner_name AS name, COUNT(*) AS wins
      FROM game_results
      GROUP BY winner_name
      ORDER BY wins DESC, winner_name ASC
      LIMIT ?
    `);

    this.lowestScoresStmt = this.db.prepare(`
      SELECT winner_name AS name, winner_score AS score
      FROM game_results
      ORDER BY winner_score ASC, id ASC
      LIMIT ?
    `);
  }

  addGameResult(winnerName, winnerScore) {
    this.insertResultStmt.run(String(winnerName), Number(winnerScore) || 0);
  }

  totalWinsTop(limit = 10) {
    return this.totalWinsStmt.all(Math.max(1, Number(limit) || 10));
  }

  lowestWinningScoresTop(limit = 10) {
    return this.lowestScoresStmt.all(Math.max(1, Number(limit) || 10));
  }

  leaderboardSnapshot(limit = 10) {
    return {
      totalWins: this.totalWinsTop(limit),
      lowestWinningScores: this.lowestWinningScoresTop(limit)
    };
  }
}
