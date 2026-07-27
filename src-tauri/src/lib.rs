// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/

use tauri::Emitter;

const KEYRING_SERVICE: &str = "com.webflowcms.app";
const KEYRING_ACCOUNT: &str = "webflow_api_token";
const MAX_RATE_LIMIT_RETRIES: u32 = 4;

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
        let resp = build_request()
            .await
            .map_err(|e| format!("Network error: {e}"))?;

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
    token: &str,
    url: &str,
) -> Result<T, String> {
    let client = reqwest::Client::new();
    send_with_rate_limit_retry(app, || client.get(url).bearer_auth(token).send()).await
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
        return Err(format!("Webflow API error ({status}): {body}"));
    }
    resp.json::<T>()
        .await
        .map_err(|e| format!("Failed to parse Webflow response: {e}"))
}

async fn webflow_post<T: serde::de::DeserializeOwned>(
    app: &tauri::AppHandle,
    token: &str,
    url: &str,
    body: &serde_json::Value,
) -> Result<T, String> {
    let client = reqwest::Client::new();
    send_with_rate_limit_retry(app, || client.post(url).bearer_auth(token).json(body).send()).await
}

async fn webflow_patch<T: serde::de::DeserializeOwned>(
    app: &tauri::AppHandle,
    token: &str,
    url: &str,
    body: &serde_json::Value,
) -> Result<T, String> {
    let client = reqwest::Client::new();
    send_with_rate_limit_retry(app, || client.patch(url).bearer_auth(token).json(body).send())
        .await
}

async fn fetch_sites(app: &tauri::AppHandle, token: &str) -> Result<Vec<WebflowSite>, String> {
    let parsed: SitesResponse =
        webflow_get(app, token, "https://api.webflow.com/v2/sites").await?;
    Ok(parsed.sites)
}

#[tauri::command]
async fn connect_with_token(app: tauri::AppHandle, token: String) -> Result<Vec<WebflowSite>, String> {
    let token = token.trim().to_string();
    if token.is_empty() {
        return Err("Token cannot be empty.".to_string());
    }

    let sites = fetch_sites(&app, &token).await?;

    let entry = keyring_entry()?;
    entry
        .set_password(&token)
        .map_err(|e| format!("Failed to store token securely: {e}"))?;

    Ok(sites)
}

#[tauri::command]
async fn try_reconnect(app: tauri::AppHandle) -> Result<Vec<WebflowSite>, String> {
    let token = get_token()?;
    fetch_sites(&app, &token).await
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
    site_id: String,
) -> Result<Vec<CollectionSummary>, String> {
    let token = get_token()?;
    let url = format!("https://api.webflow.com/v2/sites/{site_id}/collections");
    let parsed: CollectionsResponse = webflow_get(&app, &token, &url).await?;
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
    collection_id: String,
) -> Result<SchemaBundle, String> {
    let token = get_token()?;
    let url = format!("https://api.webflow.com/v2/collections/{collection_id}");
    let main: CollectionSchema = webflow_get(&app, &token, &url).await?;

    let mut referenced = Vec::new();
    for ref_id in referenced_collection_ids(&main) {
        let ref_url = format!("https://api.webflow.com/v2/collections/{ref_id}");
        match webflow_get::<CollectionSchema>(&app, &token, &ref_url).await {
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

#[derive(serde::Deserialize)]
struct ItemsResponse {
    items: Vec<CmsItem>,
}

#[tauri::command]
async fn get_items(app: tauri::AppHandle, collection_id: String) -> Result<Vec<CmsItem>, String> {
    let token = get_token()?;
    let url = format!("https://api.webflow.com/v2/collections/{collection_id}/items?limit=100");
    let parsed: ItemsResponse = webflow_get(&app, &token, &url).await?;
    Ok(parsed.items)
}

#[tauri::command]
async fn create_item(
    app: tauri::AppHandle,
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
    webflow_post(&app, &token, &url, &body).await
}

#[tauri::command]
async fn update_item(
    app: tauri::AppHandle,
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
    webflow_patch(&app, &token, &url, &body).await
}

#[tauri::command]
async fn publish_item(app: tauri::AppHandle, collection_id: String, item_id: String) -> Result<(), String> {
    let token = get_token()?;
    let url = format!("https://api.webflow.com/v2/collections/{collection_id}/items/publish");
    let body = serde_json::json!({ "itemIds": [item_id] });
    let _: serde_json::Value = webflow_post(&app, &token, &url, &body).await?;
    Ok(())
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
        .invoke_handler(tauri::generate_handler![
            connect_with_token,
            try_reconnect,
            disconnect,
            get_collections,
            get_collection_schema_bundle,
            get_items,
            create_item,
            update_item,
            publish_item
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
