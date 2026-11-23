import { requireOptionalNativeModule } from 'expo';

interface BookChatBackgroundModule {
  begin(id: number): Promise<void>;
  end(id: number): Promise<void>;
  addListener(event: 'onExpiration', listener: (event: { id: number }) => void): { remove(): void };
}

let sequence = 0;

/** Request extra iOS time before the app moves to the background. Other hosts may lack this module. */
export function beginBookChatBackgroundTask(onExpiration: () => void): (() => void) | undefined {
  const native = requireOptionalNativeModule<BookChatBackgroundModule>('ShudengChatBackground');
  if (!native) return;
  const id = ++sequence;
  const subscription = native.addListener('onExpiration', (event) => {
    if (event.id === id) onExpiration();
  });
  const started = native.begin(id).catch(() => { subscription.remove(); });
  return () => {
    subscription.remove();
    void started.then(() => native.end(id)).catch(() => {});
  };
}
