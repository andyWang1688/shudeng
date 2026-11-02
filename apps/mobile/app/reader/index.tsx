import { ReaderShell } from '../../src/ui/ReaderShell';

export default function ReaderFallbackRoute() {
  return <ReaderShell bookId="epub-demo" initialLocation={undefined} openOverride={undefined} />;
}
