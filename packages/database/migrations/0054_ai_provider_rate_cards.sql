CREATE EXTENSION IF NOT EXISTS btree_gist;

CREATE TABLE ai_provider_rate_card (
  id uuid PRIMARY KEY,
  provider text NOT NULL CHECK (provider ~ '^[a-z0-9][a-z0-9._-]{0,99}$'),
  model_family text NOT NULL CHECK (length(model_family) BETWEEN 1 AND 100),
  model_version text NOT NULL CHECK (length(model_version) BETWEEN 1 AND 100),
  currency text NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  status text NOT NULL CHECK (status IN ('draft', 'approved', 'retired')),
  effective_from timestamptz NOT NULL,
  effective_to timestamptz,
  source_reference text NOT NULL CHECK (
    length(source_reference) BETWEEN 1 AND 500
    AND (
      source_reference ~ '^https://'
      OR source_reference ~ '^market-me://'
    )
  ),
  source_hash text NOT NULL CHECK (source_hash ~ '^[0-9a-f]{64}$'),
  verified_at timestamptz NOT NULL,
  approved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ai_provider_rate_card_window_check CHECK (
    effective_to IS NULL OR effective_to > effective_from
  ),
  CONSTRAINT ai_provider_rate_card_approval_check CHECK (
    (status = 'draft' AND approved_at IS NULL)
    OR (status IN ('approved', 'retired') AND approved_at IS NOT NULL)
  )
);

ALTER TABLE ai_provider_rate_card
  ADD CONSTRAINT ai_provider_rate_card_approved_window_exclusion
  EXCLUDE USING gist (
    provider WITH =,
    model_family WITH =,
    currency WITH =,
    tstzrange(effective_from, effective_to, '[)') WITH &&
  ) WHERE (status = 'approved');

CREATE INDEX ai_provider_rate_card_effective_idx
  ON ai_provider_rate_card(currency, effective_from DESC, effective_to)
  WHERE status = 'approved';

CREATE TABLE ai_provider_rate_component (
  rate_card_id uuid NOT NULL REFERENCES ai_provider_rate_card(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('input', 'cached_input', 'output', 'request')),
  unit text NOT NULL CHECK (unit IN ('token', 'character', 'second', 'image', 'request')),
  unit_quantity integer NOT NULL CHECK (unit_quantity BETWEEN 1 AND 1000000000),
  price_micros bigint NOT NULL CHECK (price_micros BETWEEN 0 AND 1000000000000),
  PRIMARY KEY (rate_card_id, kind, unit),
  CONSTRAINT ai_provider_rate_component_request_check CHECK (
    (kind = 'request' AND unit = 'request' AND unit_quantity = 1)
    OR kind <> 'request'
  )
);

INSERT INTO ai_provider_rate_card (
  id, provider, model_family, model_version, currency, status,
  effective_from, source_reference, source_hash, verified_at, approved_at,
  created_at
) VALUES (
  '00000000-0000-4000-8000-000000000054',
  'market-me',
  'grounded-template',
  '1.0.0',
  'USD',
  'approved',
  '2026-01-01T00:00:00.000Z',
  'market-me://pricing/grounded-template/1.0.0',
  'a7c97498e411e5c55c615f7dafd01599334bd0578e70914236a1dc4d5cfc0665',
  '2026-01-01T00:00:00.000Z',
  '2026-01-01T00:00:00.000Z',
  '2026-01-01T00:00:00.000Z'
);

INSERT INTO ai_provider_rate_component (
  rate_card_id, kind, unit, unit_quantity, price_micros
) VALUES (
  '00000000-0000-4000-8000-000000000054',
  'request',
  'request',
  1,
  0
);
