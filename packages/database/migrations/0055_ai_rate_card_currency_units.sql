ALTER TABLE ai_provider_rate_card
  ADD COLUMN minor_unit_exponent smallint NOT NULL DEFAULT 2
  CHECK (minor_unit_exponent BETWEEN 0 AND 4);

ALTER TABLE ai_provider_rate_card
  ALTER COLUMN minor_unit_exponent DROP DEFAULT;
