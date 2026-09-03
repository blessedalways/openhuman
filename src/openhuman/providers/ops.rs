use super::*;

use std::path::PathBuf;

const MAX_API_ERROR_CHARS: usize = 200;

/// Fixed id for the single inference backend (OpenHuman API).
pub const INFERENCE_BACKEND_ID: &str = "openhuman";

#[derive(Debug, Clone)]
pub struct ProviderRuntimeOptions {
    pub auth_profile_override: Option<String>,
    pub openhuman_dir: Option<PathBuf>,
    pub secrets_encrypt: bool,
    pub reasoning_enabled: Option<bool>,
}

impl Default for ProviderRuntimeOptions {
    fn default() -> Self {
        Self {
            auth_profile_override: None,
            openhuman_dir: None,
            secrets_encrypt: true,
            reasoning_enabled: None,
        }
    }
}

fn is_secret_char(c: char) -> bool {
    c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | '.' | ':')
}

fn token_end(input: &str, from: usize) -> usize {
    let mut end = from;
    for (i, c) in input[from..].char_indices() {
        if is_secret_char(c) {
            end = from + i + c.len_utf8();
        } else {
            break;
        }
    }
    end
}

/// Scrub known secret-like token prefixes from provider error strings.
pub fn scrub_secret_patterns(input: &str) -> String {
    const PREFIXES: [&str; 7] = [
        "sk-",
        "xoxb-",
        "xoxp-",
        "ghp_",
        "gho_",
        "ghu_",
        "github_pat_",
    ];

    let mut scrubbed = input.to_string();

    for prefix in PREFIXES {
        let mut search_from = 0;
        loop {
            let Some(rel) = scrubbed[search_from..].find(prefix) else {
                break;
            };

            let start = search_from + rel;
            let content_start = start + prefix.len();
            let end = token_end(&scrubbed, content_start);

            if end == content_start {
                search_from = content_start;
                continue;
            }

            scrubbed.replace_range(start..end, "[REDACTED]");
            search_from = start + "[REDACTED]".len();
        }
    }

    scrubbed
}

/// Sanitize API error text by scrubbing secrets and truncating length.
pub fn sanitize_api_error(input: &str) -> String {
    let scrubbed = scrub_secret_patterns(input);

    if scrubbed.chars().count() <= MAX_API_ERROR_CHARS {
        return scrubbed;
    }

    let mut end = MAX_API_ERROR_CHARS;
    while end > 0 && !scrubbed.is_char_boundary(end) {
        end -= 1;
    }

    format!("{}...", &scrubbed[..end])
}

const TRANSPORT_ERROR_MAX_CHARS: usize = 1200;

/// Map a transport error chain to an actionable user hint, if recognized.
///
/// Windows 11 users behind TLS-intercepting software (antivirus, corporate
/// proxies) or required system proxies historically saw every provider fail
/// with an opaque "error sending request" message. Recognize the common
/// signatures so the surfaced error points at the actual fix.
fn transport_error_hint(chain: &str) -> Option<&'static str> {
    let lowered = chain.to_ascii_lowercase();

    // rustls / native-tls verification failures. The core trusts the OS
    // certificate store, so this usually means the interceptor's root CA is
    // not installed (or an old app build without OS-store trust).
    if lowered.contains("certificate")
        || lowered.contains("unknownissuer")
        || lowered.contains("handshake failure")
    {
        return Some(
            "TLS certificate verification failed. If antivirus, a VPN, or a corporate proxy \
             intercepts HTTPS (common on Windows), install its root certificate into the OS \
             certificate store or disable its HTTPS scanning, then retry.",
        );
    }

    // reqwest/hyper surface proxy failures with the proxy URL in the chain.
    if lowered.contains("proxy") {
        return Some(
            "A network proxy is configured but the connection through it failed. Check your \
             system proxy settings or the app's proxy_config, and make sure the proxy is \
             reachable.",
        );
    }

    None
}

/// Append [`transport_error_hint`] to a scrubbed chain, when one matches.
fn with_transport_hint(scrubbed: String, chain: &str) -> String {
    match transport_error_hint(chain) {
        Some(hint) if !scrubbed.contains(hint) => format!("{scrubbed} — Hint: {hint}"),
        _ => scrubbed,
    }
}

/// Full `source()` chain for connection / TLS failures (scrubbed, longer than API body snippets).
pub fn format_error_chain(err: &dyn std::error::Error) -> String {
    let mut parts: Vec<String> = vec![err.to_string()];
    let mut src = std::error::Error::source(err);
    while let Some(e) = src {
        parts.push(e.to_string());
        src = std::error::Error::source(e);
    }
    let joined = parts.join(" | ");
    let scrubbed = scrub_secret_patterns(&joined);
    let scrubbed = with_transport_hint(scrubbed, &joined);
    if scrubbed.chars().count() <= TRANSPORT_ERROR_MAX_CHARS {
        return scrubbed;
    }
    let mut end = TRANSPORT_ERROR_MAX_CHARS;
    while end > 0 && !scrubbed.is_char_boundary(end) {
        end -= 1;
    }
    format!("{}…", &scrubbed[..end])
}

/// Cause chain from [`anyhow::Error`] (e.g. responses fallback), scrubbed and length-limited.
pub fn format_anyhow_chain(err: &anyhow::Error) -> String {
    let joined = err
        .chain()
        .map(|e| e.to_string())
        .collect::<Vec<_>>()
        .join(" | ");
    let scrubbed = scrub_secret_patterns(&joined);
    let scrubbed = with_transport_hint(scrubbed, &joined);
    if scrubbed.chars().count() <= TRANSPORT_ERROR_MAX_CHARS {
        return scrubbed;
    }
    let mut end = TRANSPORT_ERROR_MAX_CHARS;
    while end > 0 && !scrubbed.is_char_boundary(end) {
        end -= 1;
    }
    format!("{}…", &scrubbed[..end])
}

/// Build a sanitized provider error from a failed HTTP response.
///
/// Also reports the failure to Sentry with `provider` and `status` tags so
/// upstream LLM errors are visible in observability without every call-site
/// having to remember to log.
pub async fn api_error(provider: &str, response: reqwest::Response) -> anyhow::Error {
    let status = response.status();
    let status_str = status.as_u16().to_string();
    let body = response
        .text()
        .await
        .unwrap_or_else(|_| "<failed to read provider error body>".to_string());
    let sanitized = sanitize_api_error(&body);
    let message = format!("{provider} API error ({status}): {sanitized}");
    crate::core::observability::report_error(
        message.as_str(),
        "llm_provider",
        "api_error",
        &[
            ("provider", provider),
            ("status", status_str.as_str()),
            ("failure", "non_2xx"),
        ],
    );
    anyhow::anyhow!(message)
}

/// Create the OpenHuman backend inference client (session JWT only).
pub fn create_backend_inference_provider(
    api_url: Option<&str>,
    api_key: Option<&str>,
    options: &ProviderRuntimeOptions,
) -> anyhow::Result<Box<dyn Provider>> {
    if let (Some(url), Some(key)) = (api_url, api_key) {
        Ok(Box::new(
            crate::openhuman::providers::compatible::OpenAiCompatibleProvider::new(
                "custom_openai",
                url,
                Some(key),
                crate::openhuman::providers::compatible::AuthStyle::Bearer,
            ),
        ))
    } else {
        if api_key.is_some() && api_url.is_none() {
            log::warn!(
                "[providers] api_key provided without api_url — key will be ignored, using default backend provider"
            );
        }
        Ok(Box::new(openhuman_backend::OpenHumanBackendProvider::new(
            api_url, options,
        )))
    }
}

/// Create provider chain with retry and fallback behavior.
pub fn create_resilient_provider(
    api_url: Option<&str>,
    api_key: Option<&str>,
    reliability: &crate::openhuman::config::ReliabilityConfig,
) -> anyhow::Result<Box<dyn Provider>> {
    create_resilient_provider_with_options(
        api_url,
        api_key,
        reliability,
        &ProviderRuntimeOptions::default(),
    )
}

/// Create provider chain with retry/fallback behavior and auth runtime options.
pub fn create_resilient_provider_with_options(
    api_url: Option<&str>,
    api_key: Option<&str>,
    reliability: &crate::openhuman::config::ReliabilityConfig,
    options: &ProviderRuntimeOptions,
) -> anyhow::Result<Box<dyn Provider>> {
    if !reliability.fallback_providers.is_empty() {
        tracing::warn!(
            "reliability.fallback_providers is ignored; inference uses only the OpenHuman backend"
        );
    }

    let primary_provider = create_backend_inference_provider(api_url, api_key, options)?;
    let providers: Vec<(String, Box<dyn Provider>)> =
        vec![(INFERENCE_BACKEND_ID.to_string(), primary_provider)];

    let reliable = reliable::ReliableProvider::new(
        providers,
        reliability.provider_retries,
        reliability.provider_backoff_ms,
    )
    .with_model_fallbacks(reliability.model_fallbacks.clone());

    Ok(Box::new(reliable))
}

/// Create a RouterProvider if model routes are configured, otherwise return a resilient provider.
pub fn create_routed_provider(
    api_url: Option<&str>,
    api_key: Option<&str>,
    reliability: &crate::openhuman::config::ReliabilityConfig,
    model_routes: &[crate::openhuman::config::ModelRouteConfig],
    default_model: &str,
) -> anyhow::Result<Box<dyn Provider>> {
    create_routed_provider_with_options(
        api_url,
        api_key,
        reliability,
        model_routes,
        default_model,
        &ProviderRuntimeOptions::default(),
    )
}

pub fn create_routed_provider_with_options(
    api_url: Option<&str>,
    api_key: Option<&str>,
    reliability: &crate::openhuman::config::ReliabilityConfig,
    model_routes: &[crate::openhuman::config::ModelRouteConfig],
    default_model: &str,
    options: &ProviderRuntimeOptions,
) -> anyhow::Result<Box<dyn Provider>> {
    if model_routes.is_empty() {
        return create_resilient_provider_with_options(api_url, api_key, reliability, options);
    }

    let backend = create_backend_inference_provider(api_url, api_key, options)?;
    let providers: Vec<(String, Box<dyn Provider>)> =
        vec![(INFERENCE_BACKEND_ID.to_string(), backend)];

    let routes: Vec<(String, router::Route)> = model_routes
        .iter()
        .map(|r| {
            (
                r.hint.clone(),
                router::Route {
                    provider_name: INFERENCE_BACKEND_ID.to_string(),
                    model: r.model.clone(),
                },
            )
        })
        .collect();

    Ok(Box::new(router::RouterProvider::new(
        providers,
        routes,
        default_model.to_string(),
    )))
}

/// Create a provider with intelligent local/remote routing.
///
/// When `config.local_ai.runtime_enabled` is `true` and Ollama is reachable,
/// lightweight and medium tasks (e.g. `hint:reaction`, `hint:summarize`) are
/// served by the local model. Heavy tasks (`hint:reasoning`, `hint:agentic`,
/// `hint:coding`) always go to the remote backend. A health-gated fallback
/// transparently promotes failed local calls to the remote backend.
///
/// Telemetry for every routing decision is emitted at `INFO` level under the
/// `"routing"` tracing target.
pub fn create_intelligent_routing_provider(
    api_url: Option<&str>,
    api_key: Option<&str>,
    config: &crate::openhuman::config::Config,
    options: &ProviderRuntimeOptions,
) -> anyhow::Result<Box<dyn Provider>> {
    let remote = create_backend_inference_provider(api_url, api_key, options)?;
    let default_model = config
        .default_model
        .as_deref()
        .unwrap_or(crate::openhuman::config::DEFAULT_MODEL);

    let provider = crate::openhuman::routing::new_provider(remote, &config.local_ai, default_model);
    Ok(Box::new(provider))
}

/// Information about a supported provider for display purposes.
pub struct ProviderInfo {
    pub name: &'static str,
    pub display_name: &'static str,
    pub aliases: &'static [&'static str],
    pub local: bool,
}

/// Return known providers for display (single backend path).
pub fn list_providers() -> Vec<ProviderInfo> {
    vec![ProviderInfo {
        name: INFERENCE_BACKEND_ID,
        display_name: "OpenHuman (backend)",
        aliases: &["backend", "openhuman-backend"],
        local: false,
    }]
}

// Legacy provider alias stubs (integrations / config); remote providers were removed.
pub fn is_glm_alias(_name: &str) -> bool {
    false
}
pub fn is_zai_alias(_name: &str) -> bool {
    false
}
pub fn is_minimax_alias(_name: &str) -> bool {
    false
}
pub fn is_moonshot_alias(_name: &str) -> bool {
    false
}
pub fn is_qianfan_alias(_name: &str) -> bool {
    false
}
pub fn is_qwen_alias(_name: &str) -> bool {
    false
}
pub fn is_qwen_oauth_alias(_name: &str) -> bool {
    false
}
pub fn canonical_china_provider_name(_name: &str) -> Option<&'static str> {
    let _ = _name;
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn factory_backend() {
        assert!(
            create_backend_inference_provider(None, None, &ProviderRuntimeOptions::default())
                .is_ok()
        );
    }

    #[test]
    fn transport_hint_matches_certificate_failures() {
        let chain = "error sending request for url (https://api.openai.com/v1/chat/completions) \
                     | invalid peer certificate: UnknownIssuer";
        assert!(transport_error_hint(chain)
            .unwrap()
            .contains("TLS certificate"));
        assert!(transport_error_hint("bad certificate: verify failed")
            .unwrap()
            .contains("OS"));
        assert!(transport_error_hint("error sending request | handshake failure").is_some());
    }

    #[test]
    fn transport_hint_matches_proxy_failures() {
        let chain = "error sending request for url (https://openrouter.ai/api/v1) | connect error \
             | proxy CONNECT tunnel failed";
        assert!(transport_error_hint(chain).unwrap().contains("proxy"));
    }

    #[test]
    fn transport_hint_ignores_unrelated_errors() {
        assert!(transport_error_hint("401 Unauthorized: bad api key").is_none());
        assert!(transport_error_hint("connection refused (os error 111)").is_none());
    }

    #[test]
    fn format_error_chain_appends_certificate_hint() {
        #[derive(Debug)]
        struct FakeTransport;
        impl std::fmt::Display for FakeTransport {
            fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
                write!(f, "invalid peer certificate: UnknownIssuer")
            }
        }
        impl std::error::Error for FakeTransport {}

        let formatted = format_error_chain(&FakeTransport);
        assert!(formatted.contains("UnknownIssuer"));
        assert!(formatted.contains("Hint:"));
        assert!(formatted.contains("antivirus, a VPN, or a corporate proxy"));
    }

    #[test]
    fn format_anyhow_chain_leaves_api_errors_unhinted() {
        let err = anyhow::anyhow!("openrouter API error (401): invalid credentials");
        let formatted = format_anyhow_chain(&err);
        assert!(!formatted.contains("Hint:"));
    }
}
