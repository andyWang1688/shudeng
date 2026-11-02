type Subscriber = (message: unknown) => void;
class Channel {
  private readonly subscribers: Subscriber[] = [];
  subscribe(subscriber: Subscriber): () => void {
    this.subscribers.push(subscriber);
    return () => {
      const index = this.subscribers.indexOf(subscriber);
      if (index >= 0) this.subscribers.splice(index, 1);
    };
  }
  publish(message: unknown): void {
    for (const subscriber of this.subscribers) subscriber(message);
  }
}
const channels = new Map<string, Channel>();
export function channel(name: string): Channel {
  let value = channels.get(name);
  if (!value) {
    value = new Channel();
    channels.set(name, value);
  }
  return value;
}
export function subscribe(): () => void {
  return () => {};
}
export function hasSubscribers(): boolean {
  return false;
}
export default { channel, subscribe, hasSubscribers };
