CREATE TABLE appearance(office TEXT PRIMARY KEY REFERENCES offices(id),value TEXT NOT NULL);
ALTER TABLE characters ADD COLUMN style TEXT;
