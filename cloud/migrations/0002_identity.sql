CREATE TABLE github_challenges(state TEXT PRIMARY KEY,binding TEXT NOT NULL,verifier TEXT NOT NULL,expires INTEGER NOT NULL);
CREATE TABLE auth_contexts(id TEXT PRIMARY KEY,version INTEGER NOT NULL,expires INTEGER NOT NULL);
CREATE TABLE github_flows(binding TEXT PRIMARY KEY,context TEXT NOT NULL REFERENCES auth_contexts(id),version INTEGER NOT NULL,stage TEXT NOT NULL,expires INTEGER NOT NULL,proof TEXT UNIQUE,identity TEXT);
CREATE TABLE external_identities(provider TEXT NOT NULL CHECK(provider='github'),subject TEXT NOT NULL,user TEXT NOT NULL REFERENCES users(id),login TEXT NOT NULL,PRIMARY KEY(provider,subject),UNIQUE(provider,user));
CREATE TRIGGER invalidate_github_flows AFTER UPDATE OF version ON auth_contexts BEGIN DELETE FROM github_flows WHERE context=NEW.id; END;
