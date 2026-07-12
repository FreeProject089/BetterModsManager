//! Shared HTTP clients.
//!
//! A `reqwest::Client` owns a connection pool and a TLS session cache. Building a
//! fresh one per request — as many commands used to — throws that away every call and
//! forces a new TCP + TLS handshake to the same host. This process-wide client is
//! built once and reused, so repeated calls (telemetry flush, catalog/blog fetch,
//! avatars, update checks) get HTTP keep-alive for free. Per-request settings
//! (timeout, User-Agent, headers) go on the `RequestBuilder`, so one client serves
//! many call sites; only clients that need a *build-time* difference (custom/invalid
//! certs, proxy, blocking) keep their own.

use std::sync::OnceLock;

/// The default async client: standard TLS + gzip + redirects, with **no** default
/// timeout or User-Agent. Set `.timeout(..)` per request, and add a
/// `.header(reqwest::header::USER_AGENT, ..)` for hosts that require one (e.g. GitHub).
pub fn client() -> &'static reqwest::Client {
    static C: OnceLock<reqwest::Client> = OnceLock::new();
    C.get_or_init(|| reqwest::Client::builder().build().unwrap_or_default())
}
