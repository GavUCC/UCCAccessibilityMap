PRAGMA foreign_keys = ON;

DELETE FROM profile_rules
WHERE id NOT IN (
  SELECT MIN(id)
  FROM profile_rules
  GROUP BY profile_id, rule_key, priority
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_profile_rules_profile_key_priority
  ON profile_rules(profile_id, rule_key, priority);
