ALTER TABLE channel_connection
  DROP CONSTRAINT channel_connection_mastodon_configuration_check;

ALTER TABLE channel_connection
  ADD CONSTRAINT channel_connection_mastodon_configuration_check
  CHECK (
    provider <> 'mastodon_account'
    OR (
      configuration->>'host' ~ '^[a-z0-9](?:[a-z0-9.-]{0,251}[a-z0-9])?$'
      AND configuration->>'host' = lower(configuration->>'host')
      AND configuration->>'instanceOrigin' = ('https://' || (configuration->>'host'))
      AND length(configuration->>'accountId') BETWEEN 1 AND 500
      AND length(configuration->>'username') BETWEEN 1 AND 500
      AND length(configuration->>'acct') BETWEEN 1 AND 500
      AND jsonb_typeof(configuration->'maxCharacters') = 'number'
      AND (configuration->>'maxCharacters')::integer BETWEEN 1 AND 100000
      AND jsonb_typeof(configuration->'charactersReservedPerUrl') = 'number'
      AND (configuration->>'charactersReservedPerUrl')::integer BETWEEN 1 AND 1000
      AND capabilities->>'provider' = 'mastodon_account'
      AND capabilities #>> '{supportedActions,publish_content}' = 'true'
      AND capabilities #>> '{features,providerMessageIdentity}' = 'true'
      AND capabilities #>> '{features,providerIdempotency}' = 'true'
      AND capabilities #>> '{limits,contentCharacters}' = configuration->>'maxCharacters'
      AND capabilities #>> '{limits,charactersReservedPerUrl}' = configuration->>'charactersReservedPerUrl'
      AND (
        (
          capabilities #>> '{features,attachments}' = 'false'
          AND capabilities #>> '{limits,attachmentsPerMessage}' = '0'
        )
        OR (
          capabilities #>> '{features,attachments}' = 'true'
          AND jsonb_typeof(configuration->'attachmentsPerMessage') = 'number'
          AND (configuration->>'attachmentsPerMessage')::integer BETWEEN 1 AND 4
          AND capabilities #>> '{limits,attachmentsPerMessage}' = configuration->>'attachmentsPerMessage'
          AND jsonb_typeof(configuration->'attachmentBytes') = 'number'
          AND (configuration->>'attachmentBytes')::integer BETWEEN 1 AND 10485760
          AND capabilities #>> '{limits,attachmentBytes}' = configuration->>'attachmentBytes'
          AND jsonb_typeof(configuration->'attachmentPixels') = 'number'
          AND (configuration->>'attachmentPixels')::integer BETWEEN 1 AND 100000000
          AND capabilities #>> '{limits,attachmentPixels}' = configuration->>'attachmentPixels'
          AND jsonb_typeof(configuration->'attachmentDescriptionCharacters') = 'number'
          AND (configuration->>'attachmentDescriptionCharacters')::integer BETWEEN 1 AND 1500
          AND capabilities #>> '{limits,attachmentDescriptionCharacters}' = configuration->>'attachmentDescriptionCharacters'
          AND jsonb_typeof(configuration->'supportedImageMimeTypes') = 'array'
          AND jsonb_array_length(configuration->'supportedImageMimeTypes') BETWEEN 1 AND 3
          AND configuration->'supportedImageMimeTypes' <@ '["image/jpeg","image/png","image/webp"]'::jsonb
          AND (capabilities #>> '{features,imageJpeg}')::boolean = (configuration->'supportedImageMimeTypes' ? 'image/jpeg')
          AND (capabilities #>> '{features,imagePng}')::boolean = (configuration->'supportedImageMimeTypes' ? 'image/png')
          AND (capabilities #>> '{features,imageWebp}')::boolean = (configuration->'supportedImageMimeTypes' ? 'image/webp')
        )
      )
    )
  );

CREATE TABLE mastodon_publication_media (
  publication_action_id uuid NOT NULL REFERENCES publication_action(id) ON DELETE CASCADE,
  ordinal integer NOT NULL CHECK (ordinal BETWEEN 0 AND 3),
  content_asset_id uuid NOT NULL REFERENCES content_asset(id) ON DELETE RESTRICT,
  content_hash text NOT NULL CHECK (content_hash ~ '^sha256:[0-9a-f]{64}$'),
  provider_media_id text NOT NULL CHECK (length(provider_media_id) BETWEEN 1 AND 500 AND provider_media_id !~ '[[:cntrl:]]'),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (publication_action_id, ordinal),
  UNIQUE (publication_action_id, provider_media_id)
);

CREATE INDEX mastodon_publication_media_asset_idx
  ON mastodon_publication_media(content_asset_id);
