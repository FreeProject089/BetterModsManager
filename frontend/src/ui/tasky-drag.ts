// tasky-drag.ts — the mascot can be moved, and stays where you put it.
//
// Tasky sits in the top-left corner over the title bar. That is a fine default and a bad
// fixed position: it is exactly where the window's own logo, the first navbar item and the
// language modal's corner all are, and there is no reason the app should be the one deciding
// which of them you would rather see.
//
// Three details that are not obvious:
//
//   · **It cannot use `transform`.** The idle bounce, the loading spin and the
//     hidden-when-maximised state are all keyframes on `transform`, and a drag written the
//     modern way would fight all three. So the drag moves `top`/`left`, and the animations
//     keep the transform to themselves.
//   · **It has to give up `data-tauri-drag-region`.** With that attribute, dragging the
//     mascot moves the WINDOW — which is why it never occurred to anyone that the mascot
//     could be moved instead. The attribute is removed here rather than in the markup so the
//     mascot still drags the window when this module has not run.
//   · **A click is not a drag.** Below the threshold nothing moves and nothing is saved, so
//     the mascot keeps behaving like a decoration for anybody who never wanted to move it.
//
// Double-click puts it back. A position you can set and cannot reset is one bad drag away
// from a mascot wedged behind the window controls.

const KEY = 'bmm_tasky_pos';
/** Below this, the pointer was shaking, not dragging. */
const DRAG_THRESHOLD_PX = 4;

interface Pos { x: number; y: number }

function read(): Pos | null {
    try {
        const raw = localStorage.getItem(KEY);
        if (!raw) return null;
        const p = JSON.parse(raw);
        return typeof p?.x === 'number' && typeof p?.y === 'number' ? p : null;
    } catch { return null; }
}

/**
 * Keep it reachable.
 *
 * A saved position is a position on the screen it was saved on. Plug the laptop out of a
 * 4K monitor and a mascot parked at x=3200 is gone for good — and the way back (double-click
 * it) needs you to be able to find it first. So every restore is clamped to the window that
 * exists now, not the one it was dropped on.
 */
function clamp(p: Pos, el: HTMLElement): Pos {
    const w = el.offsetWidth || 110;
    const h = el.offsetHeight || 110;
    // A margin of one third off-screen is allowed on purpose: tucking Tasky half into a
    // corner is a legitimate thing to want, losing it entirely is not.
    const minX = -Math.round(w / 3);
    const minY = -Math.round(h / 3);
    const maxX = Math.max(minX, window.innerWidth - Math.round(w * 2 / 3));
    const maxY = Math.max(minY, window.innerHeight - Math.round(h * 2 / 3));
    return { x: Math.min(Math.max(p.x, minX), maxX), y: Math.min(Math.max(p.y, minY), maxY) };
}

function apply(el: HTMLElement, p: Pos): void {
    el.style.left = p.x + 'px';
    el.style.top = p.y + 'px';
}

/** Back to the corner it ships in, and forget the saved position. */
export function resetTaskyPosition(): void {
    const el = document.getElementById('app-mascot-container');
    try { localStorage.removeItem(KEY); } catch { /* preference only */ }
    if (!el) return;
    el.style.left = '';
    el.style.top = '';
}

export function initTaskyDrag(): void {
    const el = document.getElementById('app-mascot-container');
    if (!el || el.dataset.dragInit === '1') return;
    el.dataset.dragInit = '1';

    // The container is pointer-events: none so it never eats a click meant for the title
    // bar underneath. Only the mascot IMAGE becomes grabbable — the container's bounding box
    // is mostly empty space around it.
    const img = el.querySelector('#app-mascot') as HTMLElement | null;
    if (!img) return;
    img.style.pointerEvents = 'auto';
    img.style.cursor = 'grab';
    // Otherwise this drags the window instead of the mascot.
    img.removeAttribute('data-tauri-drag-region');
    el.removeAttribute('data-tauri-drag-region');

    const saved = read();
    if (saved) apply(el, clamp(saved, el));

    let dragging = false;
    let moved = false;
    let startX = 0, startY = 0, baseX = 0, baseY = 0;
    let frame = 0;
    let pendingX = 0, pendingY = 0;

    const paint = () => {
        frame = 0;
        apply(el, { x: pendingX, y: pendingY });
    };

    const onDown = (e: PointerEvent) => {
        if (e.button !== 0) return;
        dragging = true;
        moved = false;
        startX = e.clientX;
        startY = e.clientY;
        const r = el.getBoundingClientRect();
        baseX = r.left;
        baseY = r.top;
        img.setPointerCapture?.(e.pointerId);
        e.preventDefault();
    };

    const onMove = (e: PointerEvent) => {
        if (!dragging) return;
        const dx = e.clientX - startX;
        const dy = e.clientY - startY;
        if (!moved && Math.hypot(dx, dy) < DRAG_THRESHOLD_PX) return;
        if (!moved) {
            moved = true;
            img.style.cursor = 'grabbing';
            // The idle bounce animates `transform`; left over during a drag it makes the
            // mascot swim away from the cursor by a few pixels a second.
            el.classList.add('is-dragging');
        }
        const p = clamp({ x: Math.round(baseX + dx), y: Math.round(baseY + dy) }, el);
        pendingX = p.x;
        pendingY = p.y;
        // One write per frame — a pointermove fires far more often than the screen redraws.
        if (!frame) frame = requestAnimationFrame(paint);
    };

    const onUp = (e: PointerEvent) => {
        if (!dragging) return;
        dragging = false;
        img.releasePointerCapture?.(e.pointerId);
        img.style.cursor = 'grab';
        el.classList.remove('is-dragging');
        if (!moved) return;                       // a click, not a drag: change nothing
        if (frame) { cancelAnimationFrame(frame); frame = 0; paint(); }
        try { localStorage.setItem(KEY, JSON.stringify({ x: pendingX, y: pendingY })); } catch { /* preference only */ }
    };

    img.addEventListener('pointerdown', onDown);
    img.addEventListener('pointermove', onMove);
    img.addEventListener('pointerup', onUp);
    img.addEventListener('pointercancel', onUp);
    img.addEventListener('dblclick', resetTaskyPosition);

    // The window can be resized smaller than the corner Tasky was parked in.
    window.addEventListener('resize', () => {
        const p = read();
        if (p) apply(el, clamp(p, el));
    });
}
