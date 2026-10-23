//! The governor's queue: tickets, per-category slots, pause / resume / cancel
//! (PLAN-BMM-RESOURCES-2026.md §1.1 and §3, phase G1).
//!
//! Every heavy operation takes a `Ticket` for its kind before it starts and holds it until it
//! ends (RAII: dropping the ticket frees the slot). While it runs it calls `checkpoint()` between
//! blocks and between files; that is where it stops when the user pauses it, where it learns it
//! was cancelled, and where background work steps aside while foreground work runs.
//!
//! What a checkpoint does, in order:
//!   1. cancelled → `Err(Cancelled)`; the caller removes its partial output and returns;
//!   2. paused (this ticket, or everything) → wait until resumed or cancelled;
//!   3. a BACKGROUND ticket (hash, maintenance) while any FOREGROUND ticket (deploy, install) is
//!      running → wait until the foreground work ends. The game folder being written is what the
//!      user is waiting for; background hashing can finish a minute later.
//!
//! Std primitives only (one Mutex, one Condvar): no async runtime, so the copy loops that run on
//! rayon threads and the `--mod-worker` process can both use it.

use super::config::OpKind;
use serde::Serialize;
use std::collections::{BTreeMap, HashMap};
use std::sync::{Arc, Condvar, Mutex};
use std::time::{Duration, Instant};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Cancelled;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum TicketState {
    Waiting,
    Running,
    Paused,
}

#[derive(Debug, Clone, Serialize)]
pub struct TicketView {
    pub id: u64,
    pub kind: OpKind,
    pub subject: String,
    pub state: TicketState,
    pub bytes_read: u64,
    pub bytes_written: u64,
    /// Milliseconds since the ticket was taken.
    pub age_ms: u64,
}

/// The longest a `pause_all` that did not come from the user may hold the queue (pentest R13,
/// owner card 2). A task step, a plugin through the API or anything else that pauses everything
/// and never resumes used to leave every later deploy waiting with nothing on screen to say why.
/// 30 minutes: long enough for what a task pauses the queue for (a backup, a benchmark, a game
/// session it starts), short enough that a forgotten pause is a delay and not a stuck BMM. A
/// task that needs longer pauses again (it holds the `resources` grant to do so). A pause the
/// user sets from the dashboard is theirs and has no end.
pub const TASK_PAUSE_MAX: Duration = Duration::from_secs(30 * 60);

/// Who paused everything, when, and until when (`None` = until someone resumes).
#[derive(Debug, Clone)]
struct PauseAll {
    by: String,
    since: Instant,
    until: Option<Instant>,
}

impl PauseAll {
    fn active(&self, now: Instant) -> bool { self.until.map_or(true, |u| now < u) }
}

/// A `pause_all` in force, as the status and the dashboard show it.
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct PauseAllView {
    /// `user` (the dashboard), `task:<name>`, `plugin:<id>`, or `unknown`.
    pub by: String,
    /// Milliseconds since the pause was set.
    pub age_ms: u64,
    /// Milliseconds before it ends by itself; `None` for the user's own pause (no end).
    pub remaining_ms: Option<u64>,
}

pub fn is_foreground(kind: OpKind) -> bool { matches!(kind, OpKind::Deploy | OpKind::Install) }
pub fn is_background(kind: OpKind) -> bool { matches!(kind, OpKind::Hash | OpKind::Maintenance) }

/// Slots per category: at most this many tickets of a kind run at once.
pub const MIN_SLOTS: usize = 1;
pub const MAX_SLOTS: usize = 16;

struct Entry {
    kind: OpKind,
    subject: String,
    running: bool,
    paused: bool,
    cancelled: bool,
    bytes_read: u64,
    bytes_written: u64,
    since: Instant,
    /// The thread that took it: runtime.rs lets a nested ticket of the same kind on the same
    /// thread skip the slot wait (see `begin_unslotted`). `None` for a ticket held by ASYNC
    /// code (`begin_detached`): a future moves between the runtime's threads and a thread runs
    /// many futures, so "the same thread" says nothing about "the same operation" there.
    thread: Option<std::thread::ThreadId>,
}

struct State {
    slots: HashMap<OpKind, usize>,
    entries: BTreeMap<u64, Entry>,
    next_id: u64,
    paused_all: Option<PauseAll>,
}

impl State {
    fn running(&self, kind: OpKind) -> usize { self.entries.values().filter(|e| e.running && e.kind == kind).count() }
    fn foreground_running(&self) -> bool { self.entries.values().any(|e| e.running && is_foreground(e.kind)) }
    fn slots_for(&self, kind: OpKind) -> usize { *self.slots.get(&kind).unwrap_or(&2) }
    /// Is everything paused right now? A bounded pause past its end is not, even before
    /// anything clears it: every reader asks here, so the end holds without a timer.
    fn all_paused(&self) -> bool { self.paused_all.as_ref().is_some_and(|p| p.active(Instant::now())) }
    /// When the pause-all in force ends by itself (a checkpoint waits no longer than that).
    fn pause_deadline(&self) -> Option<Instant> {
        self.paused_all.as_ref().filter(|p| p.active(Instant::now())).and_then(|p| p.until)
    }
}

struct Inner {
    state: Mutex<State>,
    cv: Condvar,
}

/// The queue. Cheap to clone (an `Arc`).
#[derive(Clone)]
pub struct Queue {
    inner: Arc<Inner>,
}

/// Held for the duration of one operation. Dropping it frees the slot.
pub struct Ticket {
    queue: Queue,
    id: u64,
    kind: OpKind,
}

impl Default for Queue {
    fn default() -> Self { Queue::new(HashMap::new()) }
}

impl Queue {
    /// `slots`: per-kind limits; a kind not listed gets 2 (today's copy parallelism).
    pub fn new(slots: HashMap<OpKind, usize>) -> Queue {
        let slots = slots.into_iter().map(|(k, n)| (k, n.clamp(MIN_SLOTS, MAX_SLOTS))).collect();
        Queue { inner: Arc::new(Inner { state: Mutex::new(State { slots, entries: BTreeMap::new(), next_id: 1, paused_all: None }), cv: Condvar::new() }) }
    }

    fn lock(&self) -> std::sync::MutexGuard<'_, State> {
        // A panic while holding the lock must not wedge every future operation: the state is a
        // set of counters and flags that stays consistent line by line, so recover it.
        self.inner.state.lock().unwrap_or_else(|p| p.into_inner())
    }

    fn register(&self, kind: OpKind, subject: &str, thread: Option<std::thread::ThreadId>) -> u64 {
        let mut st = self.lock();
        let id = st.next_id;
        st.next_id += 1;
        st.entries.insert(id, Entry { kind, subject: subject.chars().take(200).collect(), running: false, paused: false, cancelled: false, bytes_read: 0, bytes_written: 0, since: Instant::now(), thread });
        id
    }

    /// Take a ticket, waiting for a free slot of its kind. A ticket cancelled while it waits is
    /// returned anyway and its first checkpoint answers `Cancelled`.
    pub fn begin(&self, kind: OpKind, subject: &str) -> Ticket {
        self.begin_as(kind, subject, Some(std::thread::current().id()))
    }

    /// `begin` for a ticket that ASYNC code will hold (runtime.rs `begin_async` calls it on a
    /// blocking thread). Tied to no thread, so it never makes a later ticket on whatever thread
    /// took it look "nested" — see `Entry::thread`.
    pub fn begin_detached(&self, kind: OpKind, subject: &str) -> Ticket {
        self.begin_as(kind, subject, None)
    }

    fn begin_as(&self, kind: OpKind, subject: &str, thread: Option<std::thread::ThreadId>) -> Ticket {
        let id = self.register(kind, subject, thread);
        let mut st = self.lock();
        while st.running(kind) >= st.slots_for(kind) && !st.entries.get(&id).map(|e| e.cancelled).unwrap_or(true) {
            st = self.inner.cv.wait(st).unwrap_or_else(|p| p.into_inner());
        }
        if let Some(e) = st.entries.get_mut(&id) { e.running = true; }
        drop(st);
        Ticket { queue: self.clone(), id, kind }
    }

    /// Take a ticket only if a slot is free now.
    pub fn try_begin(&self, kind: OpKind, subject: &str) -> Option<Ticket> {
        let mut st = self.lock();
        if st.running(kind) >= st.slots_for(kind) { return None; }
        let id = st.next_id;
        st.next_id += 1;
        st.entries.insert(id, Entry { kind, subject: subject.chars().take(200).collect(), running: true, paused: false, cancelled: false, bytes_read: 0, bytes_written: 0, since: Instant::now(), thread: Some(std::thread::current().id()) });
        Some(Ticket { queue: self.clone(), id, kind })
    }

    /// A ticket that takes no slot: for work NESTED inside a ticket of the same kind on the same
    /// thread (runtime.rs decides that). Waiting for a slot there would wait for itself: with
    /// one slot (Silent) the outer ticket holds it and never releases it. Still registered, so
    /// it is visible, pausable and cancellable like any other.
    pub fn begin_unslotted(&self, kind: OpKind, subject: &str) -> Ticket {
        let id = self.register(kind, subject, Some(std::thread::current().id()));
        if let Some(e) = self.lock().entries.get_mut(&id) { e.running = true; }
        Ticket { queue: self.clone(), id, kind }
    }

    /// Does the CURRENT thread already hold a running ticket of this kind?
    pub fn held_here(&self, kind: OpKind) -> bool {
        let me = std::thread::current().id();
        self.lock().entries.values().any(|e| e.running && e.kind == kind && e.thread == Some(me))
    }

    /// Change a category's slots (clamped). Waiters are woken to re-check.
    pub fn set_slots(&self, kind: OpKind, n: usize) {
        self.lock().slots.insert(kind, n.clamp(MIN_SLOTS, MAX_SLOTS));
        self.inner.cv.notify_all();
    }

    pub fn pause(&self, id: u64) -> bool { self.flag(id, |e| e.paused = true) }
    pub fn resume(&self, id: u64) -> bool { self.flag(id, |e| e.paused = false) }
    pub fn cancel(&self, id: u64) -> bool { self.flag(id, |e| e.cancelled = true) }
    /// The user's pause-all (the dashboard's button): no end, until someone resumes.
    pub fn pause_all(&self) { self.pause_all_by("user", None); }

    /// Pause everything on behalf of `by`, for `ttl` (`None` = no end; see `TASK_PAUSE_MAX`
    /// for who gets one). A pause with no end is never shortened by a later bounded one (a
    /// task pausing while the user already paused does not arm a timer on the user's pause);
    /// two bounded pauses end at the later of the two ends.
    pub fn pause_all_by(&self, by: &str, ttl: Option<Duration>) {
        let now = Instant::now();
        let by: String = by.chars().filter(|c| !c.is_control()).take(80).collect();
        let by = if by.trim().is_empty() { "unknown".to_string() } else { by };
        let until = ttl.map(|d| now + d);
        {
            let mut st = self.lock();
            let next = match st.paused_all.take().filter(|p| p.active(now)) {
                Some(cur) if cur.until.is_none() && until.is_some() => cur,
                Some(cur) => match (cur.until, until) {
                    (Some(a), Some(b)) => PauseAll { by, since: cur.since, until: Some(a.max(b)) },
                    _ => PauseAll { by, since: cur.since, until },
                },
                None => PauseAll { by, since: now, until },
            };
            st.paused_all = Some(next);
        }
        self.inner.cv.notify_all();
    }

    pub fn resume_all(&self) { self.lock().paused_all = None; self.inner.cv.notify_all(); }

    /// The pause-all in force, if any (an expired one is cleared here).
    pub fn paused_all(&self) -> Option<PauseAllView> {
        let now = Instant::now();
        let mut st = self.lock();
        if st.paused_all.as_ref().is_some_and(|p| !p.active(now)) { st.paused_all = None; }
        st.paused_all.as_ref().map(|p| PauseAllView {
            by: p.by.clone(),
            age_ms: now.saturating_duration_since(p.since).as_millis() as u64,
            remaining_ms: p.until.map(|u| u.saturating_duration_since(now).as_millis() as u64),
        })
    }

    fn flag(&self, id: u64, f: impl FnOnce(&mut Entry)) -> bool {
        let found = { let mut st = self.lock(); st.entries.get_mut(&id).map(f).is_some() };
        self.inner.cv.notify_all();
        found
    }

    /// Everything the dashboard lists: running first, then paused, then waiting; oldest first.
    pub fn snapshot(&self) -> Vec<TicketView> {
        let st = self.lock();
        let mut v: Vec<TicketView> = st.entries.iter().map(|(&id, e)| TicketView {
            id, kind: e.kind, subject: e.subject.clone(),
            state: if !e.running { TicketState::Waiting } else if e.paused || st.all_paused() { TicketState::Paused } else { TicketState::Running },
            bytes_read: e.bytes_read, bytes_written: e.bytes_written, age_ms: e.since.elapsed().as_millis() as u64,
        }).collect();
        let rank = |s: TicketState| match s { TicketState::Running => 0, TicketState::Paused => 1, TicketState::Waiting => 2 };
        v.sort_by(|a, b| rank(a.state).cmp(&rank(b.state)).then(b.age_ms.cmp(&a.age_ms)));
        v
    }
}

impl Ticket {
    pub fn id(&self) -> u64 { self.id }
    pub fn kind(&self) -> OpKind { self.kind }

    /// Call between blocks and between files. See the module doc for what it waits on.
    pub fn checkpoint(&self) -> Result<(), Cancelled> {
        let q = &self.queue;
        let mut st = q.lock();
        loop {
            let Some(e) = st.entries.get(&self.id) else { return Err(Cancelled) };
            if e.cancelled { return Err(Cancelled); }
            let paused = e.paused || st.all_paused();
            let yield_to_foreground = is_background(self.kind) && st.foreground_running();
            if !paused && !yield_to_foreground { return Ok(()); }
            // A bounded pause-all ends with no notify: wake at its end to see it has.
            st = match st.pause_deadline() {
                Some(end) => {
                    let left = end.saturating_duration_since(Instant::now());
                    match q.inner.cv.wait_timeout(st, left) { Ok((g, _)) => g, Err(p) => p.into_inner().0 }
                }
                None => q.inner.cv.wait(st).unwrap_or_else(|p| p.into_inner()),
            };
        }
    }

    /// `checkpoint()` for ASYNC code: the same answer, waited for with a timer instead of the
    /// condition variable. `checkpoint()` parks the thread it runs on, and in an `async fn`
    /// that thread is one of the runtime's few workers — the ones the local API and the
    /// built-in repo server answer on. A sync paused from the dashboard, or held by
    /// `pause_all` (which a plugin with `resources.write` may send), parked one worker each
    /// for as long as the pause lasted (pentest R13).
    pub async fn checkpoint_async(&self) -> Result<(), Cancelled> {
        loop {
            if self.is_cancelled() { return Err(Cancelled); }
            if !self.must_yield() { return Ok(()); }
            tokio::time::sleep(std::time::Duration::from_millis(100)).await;
        }
    }

    /// Non-blocking: has this ticket been cancelled? For a caller that cannot sit in
    /// `checkpoint()` because the work runs elsewhere: the parent of a `--mod-worker` process
    /// polls it while it waits on the child, and kills the child when it turns true.
    pub fn is_cancelled(&self) -> bool {
        self.queue.lock().entries.get(&self.id).map(|e| e.cancelled).unwrap_or(true)
    }

    /// Non-blocking: would `checkpoint()` wait or fail right now (cancelled, paused, or a
    /// background ticket that must step aside for foreground work)? For work fanned out on a
    /// SHARED rayon pool, whose threads must never sit in a checkpoint: another operation may
    /// be waiting on that pool (a deploy that hashes, a second hash job), and a pool whose
    /// threads all wait for that operation to end never runs it. The job stops taking items
    /// instead, returns, and its caller calls `checkpoint()` on its own thread.
    pub fn must_yield(&self) -> bool {
        let st = self.queue.lock();
        match st.entries.get(&self.id) {
            None => true,
            Some(e) => e.cancelled || e.paused || st.all_paused() || (is_background(self.kind) && st.foreground_running()),
        }
    }

    pub fn add_bytes(&self, read: u64, written: u64) {
        let mut st = self.queue.lock();
        if let Some(e) = st.entries.get_mut(&self.id) { e.bytes_read += read; e.bytes_written += written; }
    }
}

impl Drop for Ticket {
    fn drop(&mut self) {
        self.queue.lock().entries.remove(&self.id);
        self.queue.inner.cv.notify_all();
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::mpsc;
    use std::time::Duration;

    const SOON: Duration = Duration::from_millis(80);
    const WAIT: Duration = Duration::from_secs(5);

    #[test]
    fn ticket_waits_when_its_category_is_full() {
        let q = Queue::new(HashMap::from([(OpKind::Deploy, 1)]));
        let first = q.try_begin(OpKind::Deploy, "a").expect("a free slot");
        assert!(q.try_begin(OpKind::Deploy, "b").is_none(), "the only slot is taken");
        assert!(q.try_begin(OpKind::Hash, "other kind").is_some(), "another category has its own slots");
        let (tx, rx) = mpsc::channel();
        let q2 = q.clone();
        let h = std::thread::spawn(move || { let t = q2.begin(OpKind::Deploy, "c"); tx.send(()).unwrap(); drop(t); });
        assert!(rx.recv_timeout(SOON).is_err(), "c waits while a runs");
        assert_eq!(q.snapshot().iter().filter(|v| v.state == TicketState::Waiting).count(), 1);
        drop(first);
        rx.recv_timeout(WAIT).expect("c starts once a is done");
        h.join().unwrap();
    }

    #[test]
    fn pause_blocks_checkpoint_and_resume_releases_it() {
        let q = Queue::default();
        let t = q.begin(OpKind::Extract, "zip");
        let id = t.id();
        q.pause(id);
        assert_eq!(q.snapshot()[0].state, TicketState::Paused);
        let (tx, rx) = mpsc::channel();
        let h = std::thread::spawn(move || { tx.send(t.checkpoint()).unwrap(); });
        assert!(rx.recv_timeout(SOON).is_err(), "a paused ticket waits at its checkpoint");
        q.resume(id);
        assert_eq!(rx.recv_timeout(WAIT).unwrap(), Ok(()));
        h.join().unwrap();
        // pause_all works the same way, for every ticket.
        let t2 = q.begin(OpKind::Scan, "s");
        q.pause_all();
        let (tx, rx) = mpsc::channel();
        let h = std::thread::spawn(move || { tx.send(t2.checkpoint()).unwrap(); });
        assert!(rx.recv_timeout(SOON).is_err());
        q.resume_all();
        assert_eq!(rx.recv_timeout(WAIT).unwrap(), Ok(()));
        h.join().unwrap();
    }

    #[test]
    fn cancelling_one_ticket_leaves_others_running() {
        let q = Queue::default();
        let a = q.begin(OpKind::Deploy, "a");
        let b = q.begin(OpKind::Deploy, "b");
        assert!(q.cancel(a.id()));
        assert_eq!(a.checkpoint(), Err(Cancelled));
        assert_eq!(b.checkpoint(), Ok(()));
        // Cancelling a PAUSED ticket wakes it with Cancelled instead of leaving it asleep.
        q.pause(b.id());
        let bid = b.id();
        let (tx, rx) = mpsc::channel();
        let h = std::thread::spawn(move || { tx.send(b.checkpoint()).unwrap(); });
        assert!(rx.recv_timeout(SOON).is_err());
        q.cancel(bid);
        assert_eq!(rx.recv_timeout(WAIT).unwrap(), Err(Cancelled));
        h.join().unwrap();
        assert!(!q.cancel(9999), "an unknown id is reported, not ignored silently");
    }

    #[test]
    fn foreground_ticket_pauses_background_checkpoints() {
        let q = Queue::default();
        let hash = q.begin(OpKind::Hash, "sha");
        assert_eq!(hash.checkpoint(), Ok(()), "alone, background work runs");
        let deploy = q.begin(OpKind::Deploy, "enable a mod");
        let (tx, rx) = mpsc::channel();
        let h = std::thread::spawn(move || { tx.send(hash.checkpoint()).unwrap(); });
        assert!(rx.recv_timeout(SOON).is_err(), "hashing steps aside while a deploy writes the game folder");
        assert_eq!(deploy.checkpoint(), Ok(()), "the foreground work itself never waits on this");
        drop(deploy);
        assert_eq!(rx.recv_timeout(WAIT).unwrap(), Ok(()));
        h.join().unwrap();
    }

    #[test]
    fn slots_are_clamped_and_changes_wake_waiters() {
        let q = Queue::new(HashMap::from([(OpKind::Compress, 0)]));
        let a = q.try_begin(OpKind::Compress, "a").expect("0 slots is clamped to 1, never a deadlock");
        let (tx, rx) = mpsc::channel();
        let q2 = q.clone();
        let h = std::thread::spawn(move || { let t = q2.begin(OpKind::Compress, "b"); tx.send(()).unwrap(); drop(t); });
        assert!(rx.recv_timeout(SOON).is_err());
        q.set_slots(OpKind::Compress, 2);
        rx.recv_timeout(WAIT).expect("raising the slots lets the waiter in");
        h.join().unwrap();
        q.set_slots(OpKind::Compress, 10_000);
        assert_eq!(q.lock().slots_for(OpKind::Compress), MAX_SLOTS);
        drop(a);
    }

    #[test]
    fn snapshot_sorts_running_then_paused_then_waiting_and_counts_bytes() {
        let q = Queue::new(HashMap::from([(OpKind::Install, 1)]));
        let run = q.begin(OpKind::Install, "running");
        run.add_bytes(10, 20);
        let paused = q.begin(OpKind::Scan, "paused");
        q.pause(paused.id());
        let q2 = q.clone();
        let h = std::thread::spawn(move || { let _t = q2.begin(OpKind::Install, "waiting"); });
        std::thread::sleep(SOON);
        let s = q.snapshot();
        assert_eq!(s.iter().map(|v| v.state).collect::<Vec<_>>(), vec![TicketState::Running, TicketState::Paused, TicketState::Waiting]);
        assert_eq!((s[0].bytes_read, s[0].bytes_written), (10, 20));
        drop(run);
        h.join().unwrap();
        drop(paused);
        assert!(q.snapshot().is_empty(), "every dropped ticket leaves the list");
    }

    /// Pentest R13: a paused ticket held by async code must not park the runtime's thread.
    /// One thread, two futures: the paused checkpoint, and the one that resumes it. With a
    /// checkpoint that blocks the thread, the second never runs and the pair never ends.
    #[test]
    fn an_async_checkpoint_waits_without_parking_the_runtime_thread() {
        let q = Queue::default();
        let t = q.begin_detached(OpKind::Download, "sync");
        q.pause_all();
        let (tx, rx) = mpsc::channel();
        let q2 = q.clone();
        let h = std::thread::spawn(move || {
            let rt = tokio::runtime::Builder::new_current_thread().enable_time().build().unwrap();
            let r = rt.block_on(async {
                let resume = async {
                    tokio::time::sleep(Duration::from_millis(150)).await;
                    q2.resume_all();
                };
                let (r, ()) = tokio::join!(t.checkpoint_async(), resume);
                r
            });
            let _ = tx.send(r);
        });
        assert_eq!(rx.recv_timeout(WAIT).expect("the runtime thread was parked by the checkpoint"), Ok(()));
        h.join().unwrap();
        // And a cancel ends it the same way the blocking one does.
        let t = q.begin_detached(OpKind::Download, "sync 2");
        q.cancel(t.id());
        let rt = tokio::runtime::Builder::new_current_thread().enable_time().build().unwrap();
        assert_eq!(rt.block_on(t.checkpoint_async()), Err(Cancelled));
    }

    /// Owner card 2 (pentest R13): a pause-all that did not come from the user ends by itself.
    /// A task or a plugin that paused everything and never resumed held every later deploy.
    #[test]
    fn a_bounded_pause_all_ends_by_itself_and_says_who_set_it() {
        let q = Queue::default();
        let t = q.begin(OpKind::Deploy, "enable a mod");
        q.pause_all_by("task:Nightly", Some(Duration::from_millis(300)));
        let v = q.paused_all().expect("the pause shows in the status");
        assert_eq!(v.by, "task:Nightly");
        assert!(v.remaining_ms.is_some_and(|r| r > 0 && r <= 300), "a bounded pause says how long it has left: {v:?}");
        assert_eq!(q.snapshot()[0].state, TicketState::Paused);
        let (tx, rx) = mpsc::channel();
        let h = std::thread::spawn(move || { tx.send(t.checkpoint()).unwrap(); drop(t); });
        assert!(rx.recv_timeout(SOON).is_err(), "held while the pause lasts");
        // Nobody resumes: the checkpoint wakes at the pause's end by itself.
        assert_eq!(rx.recv_timeout(WAIT).expect("a bounded pause-all never ended"), Ok(()));
        h.join().unwrap();
        assert!(q.paused_all().is_none(), "and the status no longer shows it");
    }

    #[test]
    fn the_users_pause_all_has_no_end_and_a_bounded_one_does_not_shorten_it() {
        let q = Queue::default();
        q.pause_all();
        let v = q.paused_all().unwrap();
        assert_eq!((v.by.as_str(), v.remaining_ms), ("user", None));
        // A task pausing on top of it must not arm a timer on the user's pause.
        q.pause_all_by("task:x", Some(Duration::from_millis(1)));
        std::thread::sleep(Duration::from_millis(20));
        let v = q.paused_all().expect("the user's pause outlived the task's bound");
        assert_eq!((v.by.as_str(), v.remaining_ms), ("user", None));
        let t = q.begin(OpKind::Scan, "s");
        assert!(t.must_yield());
        q.resume_all();
        assert!(q.paused_all().is_none() && !t.must_yield());
        // Two bounded pauses end at the later end; an empty or control-only label is cleaned.
        q.pause_all_by("\u{1b}\u{7}", Some(Duration::from_secs(60)));
        assert_eq!(q.paused_all().unwrap().by, "unknown");
        q.pause_all_by("plugin:p1", Some(Duration::from_secs(1)));
        let v = q.paused_all().unwrap();
        assert_eq!(v.by, "plugin:p1");
        assert!(v.remaining_ms.unwrap() > 50_000, "the later end wins: {v:?}");
        q.resume_all();
    }

    #[test]
    fn a_detached_ticket_makes_nothing_on_its_thread_look_nested() {
        let q = Queue::default();
        let t = q.begin_detached(OpKind::Download, "async sync");
        assert!(!q.held_here(OpKind::Download), "a ticket held by a future is not this thread's");
        let n = q.begin(OpKind::Download, "real");
        assert!(q.held_here(OpKind::Download));
        drop((t, n));
    }
}
