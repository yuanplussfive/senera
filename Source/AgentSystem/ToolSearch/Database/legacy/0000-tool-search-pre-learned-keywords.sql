CREATE TABLE tool_search_episodes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  query TEXT NOT NULL,
  query_tokens TEXT NOT NULL,
  planner_tags TEXT NOT NULL,
  candidates TEXT NOT NULL,
  chosen_tools TEXT NOT NULL,
  outcome TEXT NOT NULL,
  calls TEXT NOT NULL,
  final_score REAL NOT NULL,
  final_outcome TEXT NOT NULL,
  project_id TEXT NOT NULL,
  timestamp INTEGER NOT NULL
);
