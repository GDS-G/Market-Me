ALTER TABLE channel_connection
  DROP CONSTRAINT channel_connection_mastodon_configuration_check;

ALTER TABLE channel_connection
  ADD CONSTRAINT channel_connection_mastodon_configuration_check
  CHECK (
    provider <> 'mastodon_account'
    OR COALESCE((
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
    ), false)
  );
