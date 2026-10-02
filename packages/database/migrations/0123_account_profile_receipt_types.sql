-- JSON ->> compares text, so a numeric 123 could otherwise match the label "123".
-- Preserve the already-applied 0122 checksum and enforce canonical JSON string types.
ALTER TABLE account_profile_receipt ADD CONSTRAINT account_profile_receipt_string_fields CHECK ((
  canonical_request::jsonb->'accountId' = to_jsonb(account_id::text)
  AND canonical_request::jsonb->'requestId' = to_jsonb(request_id::text)
  AND canonical_request::jsonb->'displayName' = to_jsonb(display_name)
) IS TRUE);
