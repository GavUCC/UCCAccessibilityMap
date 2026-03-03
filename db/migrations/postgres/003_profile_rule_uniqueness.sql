DELETE FROM profile_rules a
USING profile_rules b
WHERE a.id > b.id
  AND a.profile_id = b.profile_id
  AND a.rule_key = b.rule_key
  AND a.priority = b.priority;

CREATE UNIQUE INDEX IF NOT EXISTS uq_profile_rules_profile_key_priority
  ON profile_rules(profile_id, rule_key, priority);
