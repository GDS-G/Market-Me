use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine as _};
use chrono::{DateTime, Utc};
use hmac::{Hmac, Mac};
use reqwest::{redirect::Policy, Client, Response};
use serde::{de::DeserializeOwned, Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::{collections::BTreeMap, fs, path::PathBuf, sync::atomic::{AtomicBool, Ordering}, time::Duration};
use tauri::{AppHandle, Manager};
use url::Url;

const APP_VERSION: &str = env!("CARGO_PKG_VERSION");
const CREDENTIAL_SERVICE: &str = "com.marketme.companion";
static LOCAL_SYNC_ACTIVE: AtomicBool = AtomicBool::new(false);

fn default_local_sync_interval_seconds() -> u64 { 60 }

#[derive(Debug, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct LocalConfiguration {
    server_url: Option<String>,
    worker_id: Option<String>,
    worker_name: Option<String>,
    local_paused: bool,
    approved_folder: Option<String>,
    #[serde(default = "default_local_sync_interval_seconds")]
    local_sync_interval_seconds: u64,
    last_local_sync_at: Option<String>,
    #[serde(default)]
    executed_job_ids: Vec<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct CompanionStatus {
    paired: bool,
    server_url: Option<String>,
    worker_id: Option<String>,
    worker_name: Option<String>,
    local_paused: bool,
    approved_folder: Option<String>,
    local_sync_interval_seconds: u64,
    last_local_sync_at: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct WorkerIdentity {
    id: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PairData {
    worker: WorkerIdentity,
    token: String,
}

#[derive(Debug, Deserialize)]
struct PairResponse {
    data: PairData,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct JobEnvelope {
    schema_version: u8,
    job_id: String,
    worker_id: String,
    workspace_id: String,
    action: String,
    mode: String,
    target_url: String,
    expected_origin: String,
    allowed_domains: Vec<String>,
    instructions: String,
    idempotency_key: String,
    claim_token: String,
    issued_at: String,
    expires_at: String,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct SignedJob {
    envelope: JobEnvelope,
    signature: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct JobClaimResponse {
    data: Option<SignedJob>,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct HeartbeatResult {
    status: String,
}

#[derive(Debug, Deserialize)]
struct HeartbeatData {
    data: HeartbeatResult,
}

#[derive(Debug, Deserialize)]
struct ApiErrorBody {
    error: Option<ApiErrorDetail>,
}

#[derive(Debug, Deserialize)]
struct ApiErrorDetail {
    message: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct LocalSourceAssignment {
    id: String,
    recursive: bool,
}

#[derive(Debug, Deserialize)]
struct LocalSourceAssignmentsResponse {
    data: Vec<LocalSourceAssignment>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct LocalManifestEntry {
    provider_item_id: String,
    provider_parent_id: Option<String>,
    name: String,
    relative_path: String,
    mime_type: String,
    is_folder: bool,
    size_bytes: u64,
    modified_at: String,
    content_hash: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct LocalManifestResult { required_uploads: Vec<String> }

#[derive(Debug, Deserialize)]
struct LocalManifestResponse { data: LocalManifestResult }

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct LocalSyncResult { source_count: usize, file_count: usize, uploaded_count: usize }

struct LocalSyncGuard;
impl Drop for LocalSyncGuard { fn drop(&mut self) { LOCAL_SYNC_ACTIVE.store(false, Ordering::Release); } }

const MAX_LOCAL_FILES: usize = 5_000;
const MAX_LOCAL_FILE_BYTES: u64 = 10 * 1024 * 1024;

fn configuration_path(app: &AppHandle) -> Result<PathBuf, String> {
    let directory = app.path().app_data_dir().map_err(|error| error.to_string())?;
    fs::create_dir_all(&directory).map_err(|error| format!("Unable to create the companion data directory: {error}"))?;
    Ok(directory.join("companion.json"))
}

fn read_configuration(app: &AppHandle) -> Result<LocalConfiguration, String> {
    let path = configuration_path(app)?;
    if !path.exists() {
        return Ok(LocalConfiguration::default());
    }
    let bytes = fs::read(path).map_err(|error| format!("Unable to read local companion settings: {error}"))?;
    serde_json::from_slice(&bytes).map_err(|error| format!("Local companion settings are invalid: {error}"))
}

fn write_configuration(app: &AppHandle, configuration: &LocalConfiguration) -> Result<(), String> {
    let path = configuration_path(app)?;
    let bytes = serde_json::to_vec_pretty(configuration).map_err(|error| error.to_string())?;
    fs::write(path, bytes).map_err(|error| format!("Unable to save local companion settings: {error}"))
}

fn credential_entry(worker_id: &str) -> Result<keyring::Entry, String> {
    keyring::Entry::new(CREDENTIAL_SERVICE, worker_id).map_err(|error| format!("Credential store unavailable: {error}"))
}

fn read_token(configuration: &LocalConfiguration) -> Result<String, String> {
    let worker_id = configuration.worker_id.as_deref().ok_or("This companion is not paired")?;
    credential_entry(worker_id)?.get_password().map_err(|error| format!("Worker credential unavailable: {error}"))
}

fn current_platform() -> Result<&'static str, String> {
    match std::env::consts::OS {
        "windows" => Ok("windows"),
        "macos" => Ok("macos"),
        "linux" => Ok("linux"),
        value => Err(format!("Unsupported operating system: {value}")),
    }
}

fn current_architecture() -> Result<&'static str, String> {
    match std::env::consts::ARCH {
        "x86_64" => Ok("x86_64"),
        "aarch64" => Ok("aarch64"),
        value => Err(format!("Unsupported architecture: {value}")),
    }
}

fn validate_server_url(value: &str) -> Result<String, String> {
    let mut url = Url::parse(value).map_err(|_| "Enter a valid Market Me server URL".to_string())?;
    let local = matches!(url.host_str(), Some("localhost" | "127.0.0.1" | "::1"));
    if url.scheme() != "https" && !(url.scheme() == "http" && local) {
        return Err("The control plane must use HTTPS except for localhost development".into());
    }
    if !url.username().is_empty() || url.password().is_some() || url.query().is_some() || url.fragment().is_some() {
        return Err("The control-plane URL cannot contain credentials, a query, or a fragment".into());
    }
    let path = url.path().trim_end_matches('/').to_string();
    url.set_path(&path);
    Ok(url.to_string().trim_end_matches('/').to_string())
}

fn client() -> Result<Client, String> {
    Client::builder().redirect(Policy::none()).timeout(Duration::from_secs(15)).user_agent(format!("Market-Me-Companion/{APP_VERSION}")).build().map_err(|error| error.to_string())
}

async fn parsed_response<T: DeserializeOwned>(response: Response) -> Result<T, String> {
    let status = response.status();
    let bytes = response.bytes().await.map_err(|error| error.to_string())?;
    if !status.is_success() {
        let body = serde_json::from_slice::<ApiErrorBody>(&bytes).ok();
        return Err(body.and_then(|value| value.error).and_then(|value| value.message).unwrap_or_else(|| format!("Market Me returned {status}")));
    }
    serde_json::from_slice(&bytes).map_err(|error| format!("Market Me returned an invalid response: {error}"))
}

fn status_from(configuration: &LocalConfiguration) -> CompanionStatus {
    let paired = configuration.worker_id.as_deref().and_then(|id| credential_entry(id).ok()).and_then(|entry| entry.get_password().ok()).is_some();
    CompanionStatus {
        paired,
        server_url: configuration.server_url.clone(),
        worker_id: configuration.worker_id.clone(),
        worker_name: configuration.worker_name.clone(),
        local_paused: configuration.local_paused,
        approved_folder: configuration.approved_folder.clone(),
        local_sync_interval_seconds: configuration.local_sync_interval_seconds,
        last_local_sync_at: configuration.last_local_sync_at.clone(),
    }
}

fn canonical_json(value: &Value) -> String {
    match value {
        Value::Null | Value::Bool(_) | Value::Number(_) | Value::String(_) => serde_json::to_string(value).expect("JSON primitive serialization cannot fail"),
        Value::Array(values) => format!("[{}]", values.iter().map(canonical_json).collect::<Vec<_>>().join(",")),
        Value::Object(values) => {
            let sorted = values.iter().collect::<BTreeMap<_, _>>();
            format!("{{{}}}", sorted.into_iter().map(|(key, item)| format!("{}:{}", serde_json::to_string(key).expect("JSON key serialization cannot fail"), canonical_json(item))).collect::<Vec<_>>().join(","))
        }
    }
}

fn verify_job_signature(envelope: &JobEnvelope, signature: &str, token: &str) -> Result<(), String> {
    let encoded = serde_json::to_value(envelope).map_err(|error| error.to_string())?;
    let supplied = URL_SAFE_NO_PAD.decode(signature).map_err(|_| "The job signature is invalid")?;
    let mut mac = Hmac::<Sha256>::new_from_slice(token.as_bytes()).map_err(|_| "Unable to initialize job verification")?;
    mac.update(canonical_json(&encoded).as_bytes());
    mac.verify_slice(&supplied).map_err(|_| "The job signature does not match".into())
}

fn validate_signed_job(signed_job: &SignedJob, token: &str, configuration: &LocalConfiguration) -> Result<Url, String> {
    let envelope = &signed_job.envelope;
    if envelope.schema_version != 1 || configuration.worker_id.as_deref() != Some(envelope.worker_id.as_str()) {
        return Err("The job is not addressed to this companion".into());
    }
    let issued_at = DateTime::parse_from_rfc3339(&envelope.issued_at).map_err(|_| "The job issue time is invalid")?.with_timezone(&Utc);
    let expires_at = DateTime::parse_from_rfc3339(&envelope.expires_at).map_err(|_| "The job expiration is invalid")?.with_timezone(&Utc);
    if expires_at <= Utc::now() || issued_at > Utc::now() + chrono::Duration::minutes(1) {
        return Err("The signed job has expired or has an invalid issue time".into());
    }
    verify_job_signature(envelope, &signed_job.signature, token)?;
    if envelope.action != "open_url" || !matches!(envelope.mode.as_str(), "assisted" | "confirm_before_submit") {
        return Err("This companion version does not allow the requested action".into());
    }
    let url = Url::parse(&envelope.target_url).map_err(|_| "The job target is invalid")?;
    let host = url.host_str().ok_or("The job target has no host")?.to_lowercase();
    if url.scheme() != "https" || !url.username().is_empty() || url.password().is_some() || url.port().is_some() || url.fragment().is_some() {
        return Err("The job target is not a credential-free HTTPS URL".into());
    }
    if !envelope.allowed_domains.iter().any(|domain| domain.to_lowercase() == host) {
        return Err("The job target is outside its exact domain allowlist".into());
    }
    if url.origin().ascii_serialization() != envelope.expected_origin {
        return Err("The job page identity does not match its expected origin".into());
    }
    Ok(url)
}

fn local_item_id(relative_path: &str) -> String {
    format!("local:{:x}", Sha256::digest(relative_path.as_bytes()))
}

fn local_mime_type(path: &std::path::Path) -> &'static str {
    match path.extension().and_then(|value| value.to_str()).unwrap_or("").to_ascii_lowercase().as_str() {
        "txt" | "md" | "log" => "text/plain",
        "csv" => "text/csv",
        "json" => "application/json",
        "xml" => "application/xml",
        "yaml" | "yml" => "application/yaml",
        "jpg" | "jpeg" => "image/jpeg",
        "png" => "image/png",
        "webp" => "image/webp",
        "gif" => "image/gif",
        "avif" => "image/avif",
        "pdf" => "application/pdf",
        "docx" => "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "pptx" => "application/vnd.openxmlformats-officedocument.presentationml.presentation",
        "xlsx" => "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "mp4" => "video/mp4",
        "mp3" => "audio/mpeg",
        "wav" => "audio/wav",
        _ => "application/octet-stream",
    }
}

fn scan_local_folder(root: &std::path::Path, recursive: bool) -> Result<Vec<(LocalManifestEntry, PathBuf)>, String> {
    fn visit(root: &std::path::Path, current: &std::path::Path, recursive: bool, output: &mut Vec<(LocalManifestEntry, PathBuf)>) -> Result<(), String> {
        for candidate in fs::read_dir(current).map_err(|error| format!("Unable to read the approved folder: {error}"))? {
            let candidate = candidate.map_err(|error| format!("Unable to inspect an approved-folder entry: {error}"))?;
            let path = candidate.path();
            let metadata = fs::symlink_metadata(&path).map_err(|error| format!("Unable to inspect an approved-folder item: {error}"))?;
            if metadata.file_type().is_symlink() { continue; }
            if metadata.is_dir() {
                if recursive { visit(root, &path, recursive, output)?; }
                continue;
            }
            if !metadata.is_file() || metadata.len() == 0 || metadata.len() > MAX_LOCAL_FILE_BYTES { continue; }
            if output.len() >= MAX_LOCAL_FILES { return Err(format!("The approved folder exceeds the {MAX_LOCAL_FILES}-file manifest limit")); }
            let relative = path.strip_prefix(root).map_err(|_| "A local item escaped the approved folder")?;
            let relative_path = relative.components().map(|part| part.as_os_str().to_string_lossy()).collect::<Vec<_>>().join("/");
            if relative_path.is_empty() || relative_path.split('/').any(|part| part == "..") { continue; }
            let bytes = fs::read(&path).map_err(|error| format!("Unable to read an approved local file: {error}"))?;
            let parent = relative.parent().filter(|value| !value.as_os_str().is_empty()).map(|value| {
                let normalized = value.components().map(|part| part.as_os_str().to_string_lossy()).collect::<Vec<_>>().join("/");
                local_item_id(&normalized)
            });
            let modified = metadata.modified().map(DateTime::<Utc>::from).map_err(|error| format!("Unable to read a local modification time: {error}"))?.to_rfc3339();
            output.push((LocalManifestEntry {
                provider_item_id: local_item_id(&relative_path), provider_parent_id: parent,
                name: candidate.file_name().to_string_lossy().to_string(), relative_path,
                mime_type: local_mime_type(&path).to_string(), is_folder: false,
                size_bytes: metadata.len(), modified_at: modified,
                content_hash: format!("sha256:{:x}", Sha256::digest(&bytes)),
            }, path));
        }
        Ok(())
    }
    let mut output = Vec::new();
    visit(root, root, recursive, &mut output)?;
    Ok(output)
}

#[tauri::command]
fn companion_status(app: AppHandle) -> Result<CompanionStatus, String> {
    Ok(status_from(&read_configuration(&app)?))
}

#[tauri::command]
async fn pair_companion(app: AppHandle, server_url: String, code: String, worker_name: String) -> Result<CompanionStatus, String> {
    let server_url = validate_server_url(&server_url)?;
    if worker_name.trim().is_empty() || worker_name.len() > 100 { return Err("Enter a device name of 1 to 100 characters".into()); }
    let response = client()?.post(format!("{server_url}/api/v1/companion/pair")).json(&json!({
        "code": code,
        "name": worker_name.trim(),
        "platform": current_platform()?,
        "architecture": current_architecture()?,
        "appVersion": APP_VERSION,
    })).send().await.map_err(|error| format!("Unable to reach Market Me: {error}"))?;
    let paired: PairResponse = parsed_response(response).await?;
    credential_entry(&paired.data.worker.id)?.set_password(&paired.data.token).map_err(|error| format!("Unable to store the worker credential: {error}"))?;
    let configuration = LocalConfiguration { server_url: Some(server_url), worker_id: Some(paired.data.worker.id), worker_name: Some(worker_name.trim().to_string()), local_sync_interval_seconds: default_local_sync_interval_seconds(), ..Default::default() };
    write_configuration(&app, &configuration)?;
    Ok(status_from(&configuration))
}

#[tauri::command]
async fn send_heartbeat(app: AppHandle) -> Result<HeartbeatResult, String> {
    let configuration = read_configuration(&app)?;
    let token = read_token(&configuration)?;
    let server_url = configuration.server_url.as_deref().ok_or("This companion is not paired")?;
    let response = client()?.post(format!("{server_url}/api/v1/companion/heartbeat")).bearer_auth(&token).json(&json!({
        "appVersion": APP_VERSION,
        "platform": current_platform()?,
        "architecture": current_architecture()?,
        "healthState": "healthy",
        "capabilities": { "signedJobs": true, "assistedOpenUrl": true, "localFolderSelection": true, "localFolderIngestion": true, "osCredentialStore": true },
        "details": { "localPaused": configuration.local_paused, "approvedFolderConfigured": configuration.approved_folder.is_some(), "localSyncIntervalSeconds": configuration.local_sync_interval_seconds, "lastLocalSyncAt": configuration.last_local_sync_at },
    })).send().await.map_err(|error| format!("Unable to send a heartbeat: {error}"))?;
    Ok(parsed_response::<HeartbeatData>(response).await?.data)
}

#[tauri::command]
async fn sync_local_sources(app: AppHandle) -> Result<LocalSyncResult, String> {
    if LOCAL_SYNC_ACTIVE.compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire).is_err() { return Err("A local source sync is already running".into()); }
    let _guard = LocalSyncGuard;
    let mut configuration = read_configuration(&app)?;
    if configuration.local_paused { return Err("Local emergency pause is active".into()); }
    let root = PathBuf::from(configuration.approved_folder.as_deref().ok_or("Choose an approved folder first")?).canonicalize().map_err(|error| format!("Unable to validate the approved folder: {error}"))?;
    let token = read_token(&configuration)?;
    let server_url = configuration.server_url.as_deref().ok_or("This companion is not paired")?;
    let assignments: LocalSourceAssignmentsResponse = parsed_response(client()?.get(format!("{server_url}/api/v1/companion/local-sources")).bearer_auth(&token).send().await.map_err(|error| format!("Unable to load local Smart Sources: {error}"))?).await?;
    let mut result = LocalSyncResult { source_count: assignments.data.len(), file_count: 0, uploaded_count: 0 };
    for source in assignments.data {
        let files = scan_local_folder(&root, source.recursive)?;
        result.file_count += files.len();
        let manifest: LocalManifestResponse = parsed_response(client()?.post(format!("{server_url}/api/v1/companion/local-sources")).bearer_auth(&token).json(&json!({
            "smartSourceId": source.id,
            "entries": files.iter().map(|(entry, _)| entry).collect::<Vec<_>>(),
        })).send().await.map_err(|error| format!("Unable to send the local manifest: {error}"))?).await?;
        for provider_item_id in manifest.data.required_uploads {
            let (_, path) = files.iter().find(|(entry, _)| entry.provider_item_id == provider_item_id).ok_or("The server requested an item outside the current manifest")?;
            let bytes = fs::read(path).map_err(|error| format!("Unable to read a requested local file: {error}"))?;
            let response = client()?.put(format!("{server_url}/api/v1/companion/local-sources/{}/items/{}/content", source.id, provider_item_id))
                .bearer_auth(&token).header("content-type", local_mime_type(path)).body(bytes).send().await.map_err(|error| format!("Unable to upload approved local content: {error}"))?;
            let _: Value = parsed_response(response).await?;
            result.uploaded_count += 1;
        }
    }
    configuration.last_local_sync_at = Some(Utc::now().to_rfc3339());
    write_configuration(&app, &configuration)?;
    Ok(result)
}

#[tauri::command]
async fn claim_job(app: AppHandle) -> Result<Option<SignedJob>, String> {
    let configuration = read_configuration(&app)?;
    if configuration.local_paused { return Ok(None); }
    let token = read_token(&configuration)?;
    let server_url = configuration.server_url.as_deref().ok_or("This companion is not paired")?;
    let response = client()?.get(format!("{server_url}/api/v1/companion/jobs")).bearer_auth(&token).send().await.map_err(|error| format!("Unable to poll companion jobs: {error}"))?;
    let claimed = parsed_response::<JobClaimResponse>(response).await?.data;
    if let Some(ref job) = claimed { validate_signed_job(job, &token, &configuration)?; }
    Ok(claimed)
}

async fn report_job(server_url: &str, token: &str, job: &SignedJob, status: &str, error: Option<&str>) -> Result<(), String> {
    let response = client()?.post(format!("{server_url}/api/v1/companion/jobs/{}/complete", job.envelope.job_id)).bearer_auth(token).json(&json!({
        "claimToken": job.envelope.claim_token,
        "status": status,
        "externalUrl": job.envelope.target_url,
        "error": error,
        "details": { "executionMethod": "default_browser", "confirmedByUser": true },
    })).send().await.map_err(|request_error| format!("Unable to report the job result: {request_error}"))?;
    let _: Value = parsed_response(response).await?;
    Ok(())
}

#[tauri::command]
async fn execute_job(app: AppHandle, signed_job: SignedJob) -> Result<(), String> {
    let mut configuration = read_configuration(&app)?;
    if configuration.local_paused { return Err("Local emergency pause is active".into()); }
    let token = read_token(&configuration)?;
    let server_url = configuration.server_url.clone().ok_or("This companion is not paired")?;
    let url = validate_signed_job(&signed_job, &token, &configuration)?;
    let already_executed = configuration.executed_job_ids.iter().any(|id| id == &signed_job.envelope.job_id);
    if !already_executed {
        configuration.executed_job_ids.push(signed_job.envelope.job_id.clone());
        if configuration.executed_job_ids.len() > 100 { configuration.executed_job_ids.drain(0..configuration.executed_job_ids.len() - 100); }
        write_configuration(&app, &configuration)?;
        if let Err(error) = open::that_detached(url.as_str()) {
            configuration.executed_job_ids.retain(|id| id != &signed_job.envelope.job_id);
            write_configuration(&app, &configuration)?;
            let message = format!("Unable to open the approved page: {error}");
            report_job(&server_url, &token, &signed_job, "failed", Some(&message)).await?;
            return Err(message);
        }
    }
    report_job(&server_url, &token, &signed_job, "succeeded", None).await
}

#[tauri::command]
fn set_local_pause(app: AppHandle, paused: bool) -> Result<CompanionStatus, String> {
    let mut configuration = read_configuration(&app)?;
    configuration.local_paused = paused;
    write_configuration(&app, &configuration)?;
    Ok(status_from(&configuration))
}

#[tauri::command]
fn set_local_sync_interval(app: AppHandle, seconds: u64) -> Result<CompanionStatus, String> {
    if seconds != 0 && !(60..=3600).contains(&seconds) { return Err("Local sync interval must be off or 60 through 3,600 seconds".into()); }
    let mut configuration = read_configuration(&app)?;
    configuration.local_sync_interval_seconds = seconds;
    write_configuration(&app, &configuration)?;
    Ok(status_from(&configuration))
}

#[tauri::command]
fn select_approved_folder(app: AppHandle) -> Result<CompanionStatus, String> {
    let mut configuration = read_configuration(&app)?;
    if let Some(folder) = rfd::FileDialog::new().set_title("Choose a folder for Market Me").pick_folder() {
        let canonical = folder.canonicalize().map_err(|error| format!("Unable to validate the selected folder: {error}"))?;
        if !canonical.is_dir() { return Err("The selected path is not a folder".into()); }
        configuration.approved_folder = Some(canonical.to_string_lossy().to_string());
        write_configuration(&app, &configuration)?;
    }
    Ok(status_from(&configuration))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![companion_status, pair_companion, send_heartbeat, sync_local_sources, claim_job, execute_job, set_local_pause, set_local_sync_interval, select_approved_folder])
        .run(tauri::generate_context!())
        .expect("error while running Market Me Companion");
}

#[cfg(test)]
mod tests {
    use super::{local_item_id, local_mime_type, verify_job_signature, JobEnvelope};
    use std::path::Path;

    #[test]
    fn local_item_identity_is_stable_and_path_sensitive() {
        assert_eq!(local_item_id("launch.txt"), "local:db6eccb769ae9cd05fe4826bae9d9aadcab4883ab976c755dcbbcd0769ecff22");
        assert_ne!(local_item_id("folder/launch.txt"), local_item_id("launch.txt"));
    }

    #[test]
    fn identifies_supported_modern_office_documents() {
        assert_eq!(local_mime_type(Path::new("brief.docx")), "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
        assert_eq!(local_mime_type(Path::new("deck.PPTX")), "application/vnd.openxmlformats-officedocument.presentationml.presentation");
        assert_eq!(local_mime_type(Path::new("metrics.xlsx")), "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    }

    #[test]
    fn verifies_the_typescript_canonical_signature_fixture() {
        let envelope: JobEnvelope = serde_json::from_value(serde_json::json!({
            "schemaVersion": 1,
            "jobId": "00000000-0000-4000-8000-000000000001",
            "workerId": "00000000-0000-4000-8000-000000000002",
            "workspaceId": "00000000-0000-4000-8000-000000000003",
            "action": "open_url",
            "mode": "assisted",
            "targetUrl": "https://example.com/test",
            "expectedOrigin": "https://example.com",
            "allowedDomains": ["example.com"],
            "instructions": "Open the test page.",
            "idempotencyKey": "companion-test-1",
            "claimToken": "claim-token-that-is-long-enough-for-the-test",
            "issuedAt": "2026-08-05T12:00:00.000Z",
            "expiresAt": "2026-08-05T12:05:00.000Z"
        })).expect("fixture must deserialize");
        let signature = "ATE_Q9GU17cg96JWcgjfX9NiH-EOY39Lxwewoy3xvrY";
        assert!(verify_job_signature(&envelope, signature, "worker-secret").is_ok());
        assert!(verify_job_signature(&envelope, signature, "different-secret").is_err());
    }
}
