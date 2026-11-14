export function bindDragSelection(surface, selector, { snapshot, preview, restore, tap }) {
  let drag;

  function cellAt(event) {
    const element = document.elementFromPoint(event.clientX, event.clientY);
    const cell = element?.closest(selector) ?? element?.closest("td")?.querySelector(selector);
    return cell && !cell.disabled && surface.contains(cell) ? cell : null;
  }

  function update(event) {
    const cell = cellAt(event);
    if (!cell || cell === drag.last || (!drag.moved && cell === drag.first)) return;
    drag.last = cell;
    drag.moved = true;
    preview(drag.first, cell, drag.before);
  }

  surface.addEventListener("pointerdown", event => {
    const first = event.target.closest(selector);
    if (!first || first.disabled || !event.isPrimary || event.button !== 0) return;
    drag = { id: event.pointerId, first, last: null, before: snapshot(), moved: false };
    surface.setPointerCapture(event.pointerId);
  });
  surface.addEventListener("pointermove", event => {
    if (drag?.id === event.pointerId) update(event);
  });
  surface.addEventListener("pointerup", event => {
    if (drag?.id !== event.pointerId) return;
    update(event);
    if (!drag.moved) tap(drag.first);
    drag = undefined;
  });
  function cancel(event) {
    if (drag?.id !== event.pointerId) return;
    if (drag.moved) restore(drag.before);
    drag = undefined;
  }
  surface.addEventListener("pointercancel", cancel);
  surface.addEventListener("lostpointercapture", cancel);

  surface.addEventListener("click", event => {
    const cell = event.target.closest(selector);
    if (cell && !cell.disabled && event.detail === 0) tap(cell);
  });
}
