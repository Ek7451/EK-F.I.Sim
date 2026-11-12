import { Button, Notice } from '@fisim/ui';
import { useProjection } from '../../engine/useResults';

export function CalculationStatus() {
  const { result, stale, error, retry } = useProjection();
  if (error)
    return (
      <Notice tone="danger">
        {result ? 'Showing the last successful result. ' : ''}The latest calculation failed: {error}{' '}
        <Button onClick={retry}>Retry calculation</Button>
      </Notice>
    );
  return stale ? (
    <p role="status" className="lv-muted">
      Updating projection…{result ? ' Showing the last successful result.' : ''}
    </p>
  ) : null;
}
