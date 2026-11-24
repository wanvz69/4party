CREATE TABLE IF NOT EXISTS schema_migrations (
  version INTEGER PRIMARY KEY,
  applied_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS parties (
  id TEXT PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  leader_id TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  type TEXT NOT NULL CHECK (type IN ('HOST', 'CARRY', 'LOOKING FOR')),
  tier INTEGER NOT NULL CHECK (tier BETWEEN 1 AND 15),
  visibility TEXT NOT NULL CHECK (visibility IN ('PUBLIC', 'PRIVATE')),
  status TEXT NOT NULL CHECK (status IN ('RECRUITING', 'FULL', 'CLOSED')),
  max_members INTEGER NOT NULL DEFAULT 10 CHECK (max_members BETWEEN 1 AND 10),
  lobby_channel_id TEXT,
  lobby_message_id TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (id, leader_id),
  FOREIGN KEY (id, leader_id) REFERENCES party_members(party_id, user_id)
    DEFERRABLE INITIALLY DEFERRED
);

CREATE TABLE IF NOT EXISTS party_members (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  party_id TEXT NOT NULL REFERENCES parties(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL UNIQUE,
  joined_at TEXT NOT NULL DEFAULT (datetime('now')),
  member_role TEXT NOT NULL DEFAULT 'MEMBER' CHECK (member_role IN ('LEADER', 'MEMBER')),
  UNIQUE (party_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_party_members_party_joined
  ON party_members(party_id, joined_at, id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_party_members_one_leader
  ON party_members(party_id) WHERE member_role = 'LEADER';
CREATE INDEX IF NOT EXISTS idx_parties_public_recruiting
  ON parties(visibility, status, created_at);

CREATE TABLE IF NOT EXISTS bot_config (
  guild_id TEXT PRIMARY KEY,
  create_category_id TEXT,
  create_channel_id TEXT,
  party_list_channel_id TEXT,
  party_lobby_category_id TEXT,
  create_panel_message_id TEXT,
  party_list_message_id TEXT,
  lobby_view_role_ids TEXT NOT NULL DEFAULT '[]',
  party_list_page INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS cleanup_tasks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  party_id TEXT NOT NULL,
  lobby_channel_id TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  attempts INTEGER NOT NULL DEFAULT 0,
  last_error TEXT
);
