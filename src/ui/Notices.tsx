/** Quiet notices: a lost graphics context, a view still being prepared. */
import { useApp } from '../state/store';

export function Notices() {
  const lost = useApp((s) => s.contextLost);
  const director = useApp((s) => s.director);
  return (
    <>
      {lost && (
        <div className="notice pe" role="alert">
          The graphics context was lost (the browser reclaimed the GPU). Everything is paused and will continue when it is restored.{' '}
          <button className="pbtn" onClick={() => location.reload()}>
            Reload
          </button>
        </div>
      )}
      {director === 'preparing' && (
        <div className="notice notice--quiet" role="status">
          Preparing the next view…
        </div>
      )}
    </>
  );
}
