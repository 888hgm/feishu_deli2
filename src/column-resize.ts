import { columns, type Config } from './model.ts';

/** 同步 colgroup、表宽及固定列偏移；不重建表格，不改变滚动位置。 */
export function applyColumnWidths(table: HTMLTableElement, config: Config): void {
  const specs = columns(config);
  table.style.width = `${specs.reduce((sum, c) => sum + c.width, 0)}px`;
  table.style.setProperty('--month-width', `${specs[0].width}px`);
  table.style.setProperty('--company-width', `${specs[1].width}px`);
  const cols = table.querySelectorAll<HTMLTableColElement>('colgroup col');
  const handles = table.querySelectorAll<HTMLElement>('.column-resizer');
  specs.forEach((column, i) => {
    if (cols[i]) cols[i].style.width = `${column.width}px`;
    if (handles[i]) {
      handles[i].setAttribute('aria-valuenow', String(column.width));
      handles[i].setAttribute('aria-valuetext', `${column.width} 像素`);
    }
  });
}
interface Options {
  grid: HTMLElement; getConfig: () => Config; enabled: () => boolean;
  change: (key: string, value: number) => void; commit: () => void;
}
export function installColumnResize(options: Options) {
  const { grid } = options;
  let drag: { key: string; handle: HTMLElement; pointerId: number; x: number; width: number; changed: boolean } | undefined;
  const handleOf = (event: Event) => event.target instanceof Element ? event.target.closest<HTMLElement>('.column-resizer') : null;
  function finish(cancelled: boolean) {
    if (!drag) return;
    const current = drag; drag = undefined;
    grid.classList.remove('resizing-columns'); document.documentElement.classList.remove('resizing-columns');
    current.handle.classList.remove('is-resizing');
    if (current.handle.hasPointerCapture(current.pointerId)) current.handle.releasePointerCapture(current.pointerId);
    if (cancelled) options.change(current.key, current.width);
    else if (current.changed) options.commit();
  }
  function pointerDown(event: PointerEvent) {
    const handle = handleOf(event);
    if (!handle || event.button !== 0 || !event.isPrimary || !options.enabled()) return;
    const column = columns(options.getConfig()).find(c => c.key === handle.dataset.columnKey);
    if (!column) return;
    finish(true); event.preventDefault(); event.stopPropagation(); handle.focus({ preventScroll: true });
    drag = { key: column.key, handle, pointerId: event.pointerId, x: event.clientX, width: column.width, changed: false };
    handle.setPointerCapture(event.pointerId); handle.classList.add('is-resizing');
    grid.classList.add('resizing-columns'); document.documentElement.classList.add('resizing-columns');
  }
  function pointerMove(event: PointerEvent) {
    if (!drag || drag.pointerId !== event.pointerId) return;
    event.preventDefault();
    options.change(drag.key, drag.width + event.clientX - drag.x);
    drag.changed = columns(options.getConfig()).find(c => c.key === drag!.key)?.width !== drag.width;
  }
  function pointerUp(event: PointerEvent) { if (drag?.pointerId === event.pointerId) finish(false); }
  function pointerCancel(event: PointerEvent) { if (drag?.pointerId === event.pointerId) finish(true); }
  function lostCapture(event: PointerEvent) { if (drag?.pointerId === event.pointerId) finish(true); }
  function keyDown(event: KeyboardEvent) {
    if (event.key === 'Escape' && drag) { event.preventDefault(); finish(true); return; }
    const handle = handleOf(event);
    if (!handle || !options.enabled()) return;
    const column = columns(options.getConfig()).find(c => c.key === handle.dataset.columnKey);
    if (!column) return;
    let value: number;
    switch (event.key) {
      case 'ArrowLeft': value = column.width - (event.shiftKey ? 1 : 10); break;
      case 'ArrowRight': value = column.width + (event.shiftKey ? 1 : 10); break;
      case 'Home': value = column.min; break;
      case 'End': value = column.max; break;
      case 'Delete': case 'Backspace': value = column.defaultWidth; break;
      default: return;
    }
    event.preventDefault(); event.stopPropagation(); options.change(column.key, value); options.commit();
  }
  function doubleClick(event: MouseEvent) {
    const handle = handleOf(event);
    if (!handle || !options.enabled()) return;
    const column = columns(options.getConfig()).find(c => c.key === handle.dataset.columnKey);
    if (column) { event.preventDefault(); options.change(column.key, column.defaultWidth); options.commit(); }
  }
  const blur = () => finish(true);
  grid.addEventListener('pointerdown', pointerDown);
  grid.addEventListener('pointermove', pointerMove);
  grid.addEventListener('pointerup', pointerUp);
  grid.addEventListener('pointercancel', pointerCancel);
  grid.addEventListener('lostpointercapture', lostCapture);
  grid.addEventListener('keydown', keyDown);
  grid.addEventListener('dblclick', doubleClick);
  window.addEventListener('blur', blur);
  return { cancel: () => finish(true) };
}
