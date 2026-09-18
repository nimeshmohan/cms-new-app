// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/

use tauri::Emitter;

const KEYRING_SERVICE: &str = "com.webflowcms.app";
const KEYRING_ACCOUNT: &str = "webflow_api_token";
const MAX_RATE_LIMIT_RETRIES: u32 = 4;
const REQUEST_TIMEOUT_SECS: u64 = 30;

fn build_http_client() -> reqwest::Client {
    reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(REQUEST_TIMEOUT_SECS))
        .build()
        .expect("failed to build HTTP client")
}

fn describe_network_error(e: reqwest::Error) -> String {
    if e.is_timeout() {
        "The request to Webflow timed out. Check your connection and try again.".to_string()
    } else if e.is_connect() {
        "Could not reach Webflow. Check your internet connection and try again.".to_string()
    } else {
        format!("Network error: {e}")
    }
}

async fn send_with_rate_limit_retry<T, F, Fut>(
    app: &tauri::AppHandle,
    build_request: F,
) -> Result<T, String>
where
    T: serde::de::DeserializeOwned,
    F: Fn() -> Fut,
    Fut: std::future::Future<Output = Result<reqwest::Response, reqwest::Error>>,
{
    let mut attempt = 0u32;
    loop {
        let resp = build_request().await.map_err(describe_network_error)?;

        if resp.status() == reqwest::StatusCode::TOO_MANY_REQUESTS && attempt < MAX_RATE_LIMIT_RETRIES {
            let wait_secs = resp
                .headers()
                .get("Retry-After")
                .and_then(|v| v.to_str().ok())
                .and_then(|s| s.parse::<u64>().ok())
                .unwrap_or_else(|| 2u64.pow(attempt + 1));

            attempt += 1;
            let _ = app.emit(
                "rate-limited",
                serde_json::json!({ "waitSecs": wait_secs, "attempt": attempt }),
            );
            tokio::time::sleep(std::time::Duration::from_secs(wait_secs)).await;
            continue;
        }

        return handle_response(resp).await;
    }
}

#[derive(serde::Serialize, serde::Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct WebflowSite {
    pub id: String,
    pub display_name: String,
    #[serde(default)]
    pub short_name: Option<String>,
}

#[derive(serde::Deserialize)]
struct SitesResponse {
    sites: Vec<WebflowSite>,
}

fn keyring_entry() -> Result<keyring::Entry, String> {
    keyring::Entry::new(KEYRING_SERVICE, KEYRING_ACCOUNT).map_err(|e| e.to_string())
}

async fn webflow_get<T: serde::de::DeserializeOwned>(
    app: &tauri::AppHandle,
    client: &reqwest::Client,
    token: &str,
    url: &str,
) -> Result<T, String> {
    send_with_rate_limit_retry(app, || client.get(url).bearer_auth(token).send()).await
}

#[derive(serde::Deserialize)]
struct WebflowErrorBody {
    #[serde(default)]
    message: Option<String>,
}

async fn handle_response<T: serde::de::DeserializeOwned>(
    resp: reqwest::Response,
) -> Result<T, String> {
    if resp.status() == reqwest::StatusCode::UNAUTHORIZED {
        return Err("Invalid or expired API token. Reconnect.".to_string());
    }
    if !resp.status().is_success() {
        let status = resp.status();
        let body = resp.text().await.unwrap_or_default();
        let message = serde_json::from_str::<WebflowErrorBody>(&body)
            .ok()
            .and_then(|e| e.message)
            .filter(|m| !m.is_empty())
            .unwrap_or_else(|| {
                if body.trim().is_empty() {
                    "No further details were provided.".to_string()
                } else {
                    body.clone()
                }
            });
        return Err(format!("Webflow rejected the request ({status}): {message}"));
    }
    resp.json::<T>()
        .await
        .map_err(|e| format!("Webflow returned a response we couldn't understand: {e}"))
}

async fn webflow_post<T: serde::de::DeserializeOwned>(
    app: &tauri::AppHandle,
    client: &reqwest::Client,
    token: &str,
    url: &str,
    body: &serde_json::Value,
) -> Result<T, String> {
    send_with_rate_limit_retry(app, || client.post(url).bearer_auth(token).json(body).send()).await
}

async fn webflow_patch<T: serde::de::DeserializeOwned>(
    app: &tauri::AppHandle,
    client: &reqwest::Client,
    token: &str,
    url: &str,
    body: &serde_json::Value,
) -> Result<T, String> {
    send_with_rate_limit_retry(app, || client.patch(url).bearer_auth(token).json(body).send())
        .await
}

async fn fetch_sites(
    app: &tauri::AppHandle,
    client: &reqwest::Client,
    token: &str,
) -> Result<Vec<WebflowSite>, String> {
    let parsed: SitesResponse =
        webflow_get(app, client, token, "https://api.webflow.com/v2/sites").await?;
    Ok(parsed.sites)
}

#[tauri::command]
async fn connect_with_token(
    app: tauri::AppHandle,
    client: tauri::State<'_, reqwest::Client>,
    token: String,
) -> Result<Vec<WebflowSite>, String> {
    let token = token.trim().to_string();
    if token.is_empty() {
        return Err("Token cannot be empty.".to_string());
    }

    let sites = fetch_sites(&app, &client, &token).await?;

    let entry = keyring_entry()?;
    entry
        .set_password(&token)
        .map_err(|e| format!("Failed to store token securely: {e}"))?;

    Ok(sites)
}

#[tauri::command]
async fn try_reconnect(
    app: tauri::AppHandle,
    client: tauri::State<'_, reqwest::Client>,
) -> Result<Vec<WebflowSite>, String> {
    let token = get_token()?;
    fetch_sites(&app, &client, &token).await
}

fn get_token() -> Result<String, String> {
    keyring_entry()?
        .get_password()
        .map_err(|e| format!("Not connected (keyring: {e}). Paste your Webflow token first."))
}

#[derive(serde::Serialize, serde::Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct CollectionSummary {
    pub id: String,
    pub display_name: String,
    #[serde(default)]
    pub singular_name: Option<String>,
    #[serde(default)]
    pub slug: Option<String>,
}

#[derive(serde::Deserialize)]
struct CollectionsResponse {
    collections: Vec<CollectionSummary>,
}

#[tauri::command]
async fn get_collections(
    app: tauri::AppHandle,
    client: tauri::State<'_, reqwest::Client>,
    site_id: String,
) -> Result<Vec<CollectionSummary>, String> {
    let token = get_token()?;
    let url = format!("https://api.webflow.com/v2/sites/{site_id}/collections");
    let parsed: CollectionsResponse = webflow_get(&app, &client, &token, &url).await?;
    Ok(parsed.collections)
}

#[derive(serde::Serialize, serde::Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct CollectionField {
    pub id: String,
    #[serde(default)]
    pub is_editable: bool,
    #[serde(default)]
    pub is_required: bool,
    #[serde(rename = "type")]
    pub field_type: String,
    pub slug: String,
    pub display_name: String,
    #[serde(default)]
    pub help_text: Option<String>,
    #[serde(default)]
    pub validations: Option<serde_json::Value>,
}

#[derive(serde::Serialize, serde::Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct CollectionSchema {
    pub id: String,
    pub display_name: String,
    #[serde(default)]
    pub singular_name: Option<String>,
    #[serde(default)]
    pub slug: Option<String>,
    #[serde(default)]
    pub fields: Vec<CollectionField>,
}

#[derive(serde::Serialize, Debug, Clone)]
pub struct SchemaBundle {
    pub main: CollectionSchema,
    pub referenced: Vec<CollectionSchema>,
}

fn referenced_collection_ids(schema: &CollectionSchema) -> Vec<String> {
    let mut ids = Vec::new();
    for field in &schema.fields {
        let ftype = field.field_type.to_lowercase();
        if ftype != "reference" && ftype != "multireference" {
            continue;
        }
        let Some(cid) = field
            .validations
            .as_ref()
            .and_then(|v| v.get("collectionId"))
            .and_then(|v| v.as_str())
        else {
            continue;
        };
        if cid != schema.id && !ids.iter().any(|id: &String| id == cid) {
            ids.push(cid.to_string());
        }
    }
    ids
}

#[tauri::command]
async fn get_collection_schema_bundle(
    app: tauri::AppHandle,
    client: tauri::State<'_, reqwest::Client>,
    collection_id: String,
) -> Result<SchemaBundle, String> {
    let token = get_token()?;
    let url = format!("https://api.webflow.com/v2/collections/{collection_id}");
    let main: CollectionSchema = webflow_get(&app, &client, &token, &url).await?;

    let mut referenced = Vec::new();
    for ref_id in referenced_collection_ids(&main) {
        let ref_url = format!("https://api.webflow.com/v2/collections/{ref_id}");
        match webflow_get::<CollectionSchema>(&app, &client, &token, &ref_url).await {
            Ok(schema) => referenced.push(schema),
            Err(e) => eprintln!("Failed to fetch referenced collection {ref_id}: {e}"),
        }
    }

    Ok(SchemaBundle { main, referenced })
}

#[derive(serde::Serialize, serde::Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct CmsItem {
    pub id: String,
    #[serde(default)]
    pub is_draft: bool,
    #[serde(default)]
    pub is_archived: bool,
    #[serde(default)]
    pub last_published: Option<String>,
    #[serde(default)]
    pub last_updated: Option<String>,
    #[serde(default)]
    pub created_on: Option<String>,
    #[serde(default)]
    pub field_data: serde_json::Value,
}

#[derive(serde::Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct ItemsPagination {
    #[serde(default)]
    total: u64,
}

#[derive(serde::Deserialize)]
struct ItemsResponse {
    items: Vec<CmsItem>,
    #[serde(default)]
    pagination: ItemsPagination,
}

const ITEMS_PAGE_SIZE: u64 = 100;

#[tauri::command]
async fn get_items(
    app: tauri::AppHandle,
    client: tauri::State<'_, reqwest::Client>,
    collection_id: String,
) -> Result<Vec<CmsItem>, String> {
    let token = get_token()?;
    let mut all_items = Vec::new();
    let mut offset = 0u64;

    loop {
        let url = format!(
            "https://api.webflow.com/v2/collections/{collection_id}/items?limit={ITEMS_PAGE_SIZE}&offset={offset}"
        );
        let parsed: ItemsResponse = webflow_get(&app, &client, &token, &url).await?;
        let fetched = parsed.items.len() as u64;
        all_items.extend(parsed.items);

        offset += ITEMS_PAGE_SIZE;
        let total = parsed.pagination.total;
        if fetched == 0 || offset >= total {
            break;
        }
    }

    Ok(all_items)
}

#[tauri::command]
async fn create_item(
    app: tauri::AppHandle,
    client: tauri::State<'_, reqwest::Client>,
    collection_id: String,
    field_data: serde_json::Value,
    is_draft: bool,
) -> Result<CmsItem, String> {
    let token = get_token()?;
    let url = format!("https://api.webflow.com/v2/collections/{collection_id}/items");
    let body = serde_json::json!({
        "isDraft": is_draft,
        "isArchived": false,
        "fieldData": field_data,
    });
    webflow_post(&app, &client, &token, &url, &body).await
}

#[tauri::command]
async fn update_item(
    app: tauri::AppHandle,
    client: tauri::State<'_, reqwest::Client>,
    collection_id: String,
    item_id: String,
    field_data: serde_json::Value,
    is_draft: bool,
) -> Result<CmsItem, String> {
    let token = get_token()?;
    let url = format!("https://api.webflow.com/v2/collections/{collection_id}/items/{item_id}");
    let body = serde_json::json!({
        "isDraft": is_draft,
        "fieldData": field_data,
    });
    webflow_patch(&app, &client, &token, &url, &body).await
}

#[tauri::command]
async fn publish_item(
    app: tauri::AppHandle,
    client: tauri::State<'_, reqwest::Client>,
    collection_id: String,
    item_id: String,
) -> Result<(), String> {
    let token = get_token()?;
    let url = format!("https://api.webflow.com/v2/collections/{collection_id}/items/publish");
    let body = serde_json::json!({ "itemIds": [item_id] });
    let _: serde_json::Value = webflow_post(&app, &client, &token, &url, &body).await?;
    Ok(())
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct AssetUploadMeta {
    id: String,
    upload_url: String,
    upload_details: serde_json::Map<String, serde_json::Value>,
    #[serde(default)]
    hosted_url: Option<String>,
}

#[derive(serde::Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct UploadedAsset {
    pub file_id: String,
    pub url: String,
}

fn guess_mime(file_name: &str) -> &'static str {
    let ext = file_name.rsplit('.').next().unwrap_or("").to_lowercase();
    match ext.as_str() {
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "gif" => "image/gif",
        "webp" => "image/webp",
        "svg" => "image/svg+xml",
        "pdf" => "application/pdf",
        _ => "application/octet-stream",
    }
}

#[tauri::command]
async fn upload_asset(
    app: tauri::AppHandle,
    client: tauri::State<'_, reqwest::Client>,
    site_id: String,
    file_path: String,
) -> Result<UploadedAsset, String> {
    let token = get_token()?;

    let bytes = std::fs::read(&file_path).map_err(|e| format!("Failed to read file: {e}"))?;
    let file_name = std::path::Path::new(&file_path)
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_else(|| "upload".to_string());

    let hash = format!("{:x}", md5::compute(&bytes));

    let meta_url = format!("https://api.webflow.com/v2/sites/{site_id}/assets");
    let meta_body = serde_json::json!({ "fileName": file_name, "fileHash": hash });
    let meta: AssetUploadMeta = webflow_post(&app, &client, &token, &meta_url, &meta_body).await?;

    let mut form = reqwest::multipart::Form::new();
    for (key, value) in &meta.upload_details {
        let value_str = value.as_str().map(str::to_string).unwrap_or_else(|| value.to_string());
        form = form.text(key.clone(), value_str);
    }
    let part = reqwest::multipart::Part::bytes(bytes)
        .file_name(file_name.clone())
        .mime_str(guess_mime(&file_name))
        .map_err(|e| format!("Invalid file type: {e}"))?;
    form = form.part("file", part);

    let resp = client
        .post(&meta.upload_url)
        .multipart(form)
        .send()
        .await
        .map_err(describe_network_error)?;

    if !resp.status().is_success() {
        let status = resp.status();
        let body = resp.text().await.unwrap_or_default();
        let detail = if body.trim().is_empty() {
            "No further details were provided.".to_string()
        } else {
            body
        };
        return Err(format!("Asset storage rejected the upload ({status}): {detail}"));
    }

    Ok(UploadedAsset {
        file_id: meta.id,
        url: meta.hosted_url.unwrap_or_default(),
    })
}

#[cfg(windows)]
mod native_file_picker {
    use windows_sys::Win32::UI::Controls::Dialogs::{
        GetOpenFileNameW, OFN_ALLOWMULTISELECT, OFN_EXPLORER, OFN_FILEMUSTEXIST,
        OFN_PATHMUSTEXIST, OPENFILENAMEW,
    };

    pub fn pick_files(images: bool, multiple: bool) -> Result<Vec<String>, String> {
        let filter: &str = if images {
            "Image Files\0*.png;*.jpg;*.jpeg;*.gif;*.webp;*.svg\0All Files\0*.*\0\0"
        } else {
            "All Files\0*.*\0\0"
        };
        let mut filter_wide: Vec<u16> = filter.encode_utf16().collect();

        const BUF_SIZE: usize = 32768;
        let mut buffer: Vec<u16> = vec![0; BUF_SIZE];

        let mut ofn: OPENFILENAMEW = unsafe { std::mem::zeroed() };
        ofn.lStructSize = std::mem::size_of::<OPENFILENAMEW>() as u32;
        ofn.lpstrFilter = filter_wide.as_mut_ptr();
        ofn.lpstrFile = buffer.as_mut_ptr();
        ofn.nMaxFile = BUF_SIZE as u32;
        let mut flags = OFN_EXPLORER | OFN_FILEMUSTEXIST | OFN_PATHMUSTEXIST;
        if multiple {
            flags |= OFN_ALLOWMULTISELECT;
        }
        ofn.Flags = flags;

        let ok = unsafe { GetOpenFileNameW(&mut ofn) };
        if ok == 0 {
            return Ok(vec![]);
        }

        let mut parts: Vec<String> = Vec::new();
        let mut start = 0usize;
        for i in 0..buffer.len() {
            if buffer[i] == 0 {
                if i == start {
                    break;
                }
                parts.push(String::from_utf16_lossy(&buffer[start..i]));
                start = i + 1;
            }
        }

        if parts.is_empty() {
            return Ok(vec![]);
        }
        if parts.len() == 1 {
            return Ok(parts);
        }

        let dir = parts[0].clone();
        Ok(parts[1..].iter().map(|f| format!("{dir}\\{f}")).collect())
    }
}

#[cfg(not(windows))]
mod native_file_picker {
    pub fn pick_files(_images: bool, _multiple: bool) -> Result<Vec<String>, String> {
        Err("File picker isn't implemented on this OS yet.".to_string())
    }
}

#[tauri::command]
fn pick_files(images: bool, multiple: bool) -> Result<Vec<String>, String> {
    native_file_picker::pick_files(images, multiple)
}

#[tauri::command]
fn disconnect() -> Result<(), String> {
    let entry = keyring_entry()?;
    match entry.delete_credential() {
        Ok(_) => Ok(()),
        Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(e.to_string()),
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .manage(build_http_client())
        .invoke_handler(tauri::generate_handler![
            connect_with_token,
            try_reconnect,
            disconnect,
            get_collections,
            get_collection_schema_bundle,
            get_items,
            create_item,
            update_item,
            publish_item,
            upload_asset,
            pick_files
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
