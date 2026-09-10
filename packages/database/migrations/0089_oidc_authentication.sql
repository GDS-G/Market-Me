CREATE TABLE oidc_auth_state (
  state_hash text PRIMARY KEY,
  issuer text NOT NULL,
  nonce_hash text NOT NULL,
  code_verifier text NOT NULL,
  return_to text NOT NULL DEFAULT '/smart-sources',
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT oidc_auth_state_state_hash_length CHECK (char_length(state_hash) BETWEEN 32 AND 128),
  CONSTRAINT oidc_auth_state_issuer_length CHECK (char_length(issuer) BETWEEN 8 AND 2048),
  CONSTRAINT oidc_auth_state_nonce_hash_length CHECK (char_length(nonce_hash) BETWEEN 32 AND 128),
  CONSTRAINT oidc_auth_state_code_verifier_length CHECK (char_length(code_verifier) BETWEEN 43 AND 128),
  CONSTRAINT oidc_auth_state_return_to_local CHECK (
    char_length(return_to) BETWEEN 1 AND 2048
    AND return_to LIKE '/%'
    AND return_to NOT LIKE '//%'
    AND position(E'\\' in return_to) = 0
  )
);

CREATE INDEX oidc_auth_state_expiry_idx ON oidc_auth_state(expires_at);

CREATE TABLE oidc_identity (
  issuer text NOT NULL,
  subject text NOT NULL,
  user_id uuid NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
  email_at_link text NOT NULL,
  linked_at timestamptz NOT NULL DEFAULT now(),
  last_login_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (issuer, subject),
  UNIQUE (issuer, user_id),
  CONSTRAINT oidc_identity_issuer_length CHECK (char_length(issuer) BETWEEN 8 AND 2048),
  CONSTRAINT oidc_identity_subject_length CHECK (char_length(subject) BETWEEN 1 AND 255),
  CONSTRAINT oidc_identity_email_length CHECK (char_length(email_at_link) BETWEEN 3 AND 320)
);

CREATE INDEX oidc_identity_user_idx ON oidc_identity(user_id);
