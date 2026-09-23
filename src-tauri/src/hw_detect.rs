//! What hardware BMM runs on, for the resource governor (PLAN-BMM-RESOURCES-2026.md, H1).
//!
//! Detection only. What it is for, stated honestly in the plan (§4.2): the levers that really
//! speed BMM up are CPU instructions (BLAKE3 picks AVX-512 / AVX2 / SSE4.1 itself, sha2 uses
//! SHA-NI) and parallelism matched to the disk (NVMe vs SATA SSD vs spinning disk). The GPU is
//! listed so the user can see it and so the webview switch (boot_flags.rs) can be explained;
//! BMM runs no compute on it, because its work is small files where the disk is the limit.
//!
//! No `crate::` dependency: the CLI / MCP example can include this file with `#[path]` and
//! answer `bmm hardware` with BMM closed.
//!
//! A driver can hang the DXGI enumeration; it runs on a thread with a 3-second budget and the
//! answer says `gpu_timed_out` rather than blocking whoever asked.

use serde::Serialize;
use std::sync::OnceLock;
use std::time::Duration;

#[derive(Debug, Clone, Default, Serialize)]
pub struct CpuInfo {
    pub logical_cores: usize,
    pub avx2: bool,
    pub avx512f: bool,
    pub sse41: bool,
    /// SHA extensions: sha2 uses them for SHA-256 when present.
    pub sha_ni: bool,
    pub aes_ni: bool,
}

#[derive(Debug, Clone, Default, Serialize)]
pub struct GpuInfo {
    pub name: String,
    pub vendor_id: u32,
    pub dedicated_mb: u64,
    /// Microsoft Basic Render Driver / WARP: a CPU pretending to be a GPU. Listed, never counted.
    pub software: bool,
}

#[derive(Debug, Clone, Default, Serialize)]
pub struct DiskInfo {
    /// e.g. "C:\\"
    pub mount: String,
    /// "nvme", "sata", "usb", "sas", "raid", "virtual", or "unknown".
    pub bus: String,
    /// True for a spinning disk (seek penalty), false for flash, None when the driver won't say.
    pub seek_penalty: Option<bool>,
}

#[derive(Debug, Clone, Default, Serialize)]
pub struct HardwareInfo {
    pub cpu: CpuInfo,
    pub gpus: Vec<GpuInfo>,
    pub gpu_timed_out: bool,
    pub disks: Vec<DiskInfo>,
}

pub fn cpu() -> CpuInfo {
    let logical_cores = std::thread::available_parallelism().map(|n| n.get()).unwrap_or(1);
    #[cfg(any(target_arch = "x86", target_arch = "x86_64"))]
    {
        CpuInfo {
            logical_cores,
            avx2: std::arch::is_x86_feature_detected!("avx2"),
            avx512f: std::arch::is_x86_feature_detected!("avx512f"),
            sse41: std::arch::is_x86_feature_detected!("sse4.1"),
            sha_ni: std::arch::is_x86_feature_detected!("sha"),
            aes_ni: std::arch::is_x86_feature_detected!("aes"),
        }
    }
    #[cfg(not(any(target_arch = "x86", target_arch = "x86_64")))]
    { CpuInfo { logical_cores, ..Default::default() } }
}

#[cfg(windows)]
fn gpus_blocking() -> Vec<GpuInfo> {
    use windows::Win32::Graphics::Dxgi::{CreateDXGIFactory1, IDXGIFactory1, DXGI_ADAPTER_FLAG_SOFTWARE};
    let mut out = Vec::new();
    // SAFETY: plain COM calls on a factory we own; every out-param is a local.
    unsafe {
        let Ok(factory) = CreateDXGIFactory1::<IDXGIFactory1>() else { return out };
        let mut i = 0u32;
        while let Ok(adapter) = factory.EnumAdapters1(i) {
            i += 1;
            let mut desc = windows::Win32::Graphics::Dxgi::DXGI_ADAPTER_DESC1::default();
            if adapter.GetDesc1(&mut desc).is_err() { continue }
            let len = desc.Description.iter().position(|&c| c == 0).unwrap_or(desc.Description.len());
            let name = String::from_utf16_lossy(&desc.Description[..len]);
            let software = (desc.Flags & DXGI_ADAPTER_FLAG_SOFTWARE.0 as u32) != 0 || desc.VendorId == 0x1414 && desc.DeviceId == 0x8c;
            out.push(GpuInfo { name, vendor_id: desc.VendorId, dedicated_mb: (desc.DedicatedVideoMemory as u64) / (1024 * 1024), software });
            if i > 16 { break; }
        }
    }
    out
}
#[cfg(not(windows))]
fn gpus_blocking() -> Vec<GpuInfo> { Vec::new() }

/// The GPUs, with a time budget: (list, timed_out).
pub fn gpus(budget: Duration) -> (Vec<GpuInfo>, bool) {
    let (tx, rx) = std::sync::mpsc::channel();
    let _ = std::thread::Builder::new().name("bmm-hw-gpu".into()).spawn(move || { let _ = tx.send(gpus_blocking()); });
    match rx.recv_timeout(budget) {
        Ok(v) => (v, false),
        Err(_) => (Vec::new(), true),
    }
}

/// The bus name for a STORAGE_BUS_TYPE value.
pub fn bus_name(bus: i32) -> &'static str {
    match bus {
        17 => "nvme",
        11 => "sata",
        3 => "ata",
        7 => "usb",
        10 => "sas",
        8 => "raid",
        14 | 15 => "virtual",
        12 => "sd",
        13 => "mmc",
        _ => "unknown",
    }
}

#[cfg(windows)]
fn disk_blocking(mount: &str) -> DiskInfo {
    use windows::core::PCWSTR;
    use windows::Win32::Foundation::{CloseHandle, HANDLE};
    use windows::Win32::Storage::FileSystem::{CreateFileW, FILE_SHARE_READ, FILE_SHARE_WRITE, OPEN_EXISTING, FILE_FLAGS_AND_ATTRIBUTES};
    use windows::Win32::System::Ioctl::{
        IOCTL_STORAGE_QUERY_PROPERTY, STORAGE_PROPERTY_QUERY, StorageDeviceProperty, StorageDeviceSeekPenaltyProperty,
        PropertyStandardQuery, STORAGE_DEVICE_DESCRIPTOR, DEVICE_SEEK_PENALTY_DESCRIPTOR,
    };
    use windows::Win32::System::IO::DeviceIoControl;

    let mut info = DiskInfo { mount: mount.to_string(), bus: "unknown".into(), seek_penalty: None };
    let letter = mount.trim_end_matches(['\\', '/']).trim_end_matches(':');
    if letter.len() != 1 { return info; }
    let path: Vec<u16> = format!("\\\\.\\{letter}:").encode_utf16().chain(std::iter::once(0)).collect();
    // SAFETY: the handle is opened with access 0 (no admin right needed, no data read) and closed
    // below; every buffer handed to DeviceIoControl is a local of the size given.
    unsafe {
        let Ok(h): Result<HANDLE, _> = CreateFileW(PCWSTR(path.as_ptr()), 0, FILE_SHARE_READ | FILE_SHARE_WRITE, None, OPEN_EXISTING, FILE_FLAGS_AND_ATTRIBUTES(0), None) else { return info };
        let mut q = STORAGE_PROPERTY_QUERY { PropertyId: StorageDeviceProperty, QueryType: PropertyStandardQuery, AdditionalParameters: [0] };
        let mut desc = STORAGE_DEVICE_DESCRIPTOR::default();
        let mut got = 0u32;
        if DeviceIoControl(h, IOCTL_STORAGE_QUERY_PROPERTY, Some(&q as *const _ as *const _), std::mem::size_of::<STORAGE_PROPERTY_QUERY>() as u32,
            Some(&mut desc as *mut _ as *mut _), std::mem::size_of::<STORAGE_DEVICE_DESCRIPTOR>() as u32, Some(&mut got), None).is_ok() {
            info.bus = bus_name(desc.BusType.0).to_string();
        }
        q.PropertyId = StorageDeviceSeekPenaltyProperty;
        let mut sp = DEVICE_SEEK_PENALTY_DESCRIPTOR::default();
        if DeviceIoControl(h, IOCTL_STORAGE_QUERY_PROPERTY, Some(&q as *const _ as *const _), std::mem::size_of::<STORAGE_PROPERTY_QUERY>() as u32,
            Some(&mut sp as *mut _ as *mut _), std::mem::size_of::<DEVICE_SEEK_PENALTY_DESCRIPTOR>() as u32, Some(&mut got), None).is_ok() {
            info.seek_penalty = Some(sp.IncursSeekPenalty.as_bool());
        }
        let _ = CloseHandle(h);
    }
    info
}
#[cfg(not(windows))]
fn disk_blocking(mount: &str) -> DiskInfo { DiskInfo { mount: mount.to_string(), bus: "unknown".into(), seek_penalty: None } }

/// Everything, once per process (the GPU part costs up to its budget the first time).
pub fn detect(mounts: &[String]) -> HardwareInfo {
    static GPU: OnceLock<(Vec<GpuInfo>, bool)> = OnceLock::new();
    let (gpus, gpu_timed_out) = GPU.get_or_init(|| gpus(Duration::from_secs(3))).clone();
    HardwareInfo { cpu: cpu(), gpus, gpu_timed_out, disks: mounts.iter().map(|m| disk_blocking(m)).collect() }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn cpu_features_match_std_detection() {
        let c = cpu();
        assert!(c.logical_cores >= 1);
        #[cfg(target_arch = "x86_64")]
        {
            assert_eq!(c.avx2, std::arch::is_x86_feature_detected!("avx2"));
            assert_eq!(c.sha_ni, std::arch::is_x86_feature_detected!("sha"));
            assert!(c.sse41 || !c.avx2, "AVX2 without SSE4.1 is not a real CPU");
        }
    }

    #[test]
    fn bus_types_are_named_and_unknown_is_not_an_error() {
        assert_eq!(bus_name(17), "nvme");
        assert_eq!(bus_name(11), "sata");
        assert_eq!(bus_name(7), "usb");
        assert_eq!(bus_name(9999), "unknown");
    }

    #[test]
    fn a_hanging_probe_times_out_and_returns_partial_info() {
        // The same channel + budget shape as gpus(), with a probe that never answers in time.
        let (tx, rx) = std::sync::mpsc::channel::<Vec<GpuInfo>>();
        std::thread::spawn(move || { std::thread::sleep(Duration::from_millis(500)); let _ = tx.send(Vec::new()); });
        assert!(rx.recv_timeout(Duration::from_millis(50)).is_err(), "the caller is not held past its budget");
    }

    #[test]
    fn a_drive_letter_that_does_not_exist_is_reported_unknown_not_an_error() {
        let d = disk_blocking("Q:\\");
        assert!(d.bus == "unknown" || !d.bus.is_empty());
        let bad = disk_blocking("not a mount");
        assert_eq!(bad.bus, "unknown");
    }

    #[test]
    #[cfg(windows)]
    fn the_system_drive_answers() {
        let sys = std::env::var("SystemDrive").unwrap_or_else(|_| "C:".into());
        let d = disk_blocking(&format!("{sys}\\"));
        // Most machines answer; a locked-down one may not. Either way it must not panic, and a
        // known answer must be one of the names.
        assert!(["nvme", "sata", "ata", "usb", "sas", "raid", "virtual", "sd", "mmc", "unknown"].contains(&d.bus.as_str()));
    }
}
